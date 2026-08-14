import type { ModelMessage } from 'ai'
import { approximateTokenCount } from '../../../../src/lib/contextUsage'
import { stripExecutionModeContext } from '../../../../src/lib/executionModeContext'
import { sanitizeCompactionContent } from './sanitize'
import { truncatePreservingEdges } from './codeModeProjection'
import type { UserPromptLedgerEntry } from './contracts'
import { renderUserPromptLedger, USER_PROMPT_LEDGER_HEADING } from './userPromptLedgerRendering'
const MAX_LEDGER_PROMPT_CHARS = 16_000

function promptContent(message: ModelMessage) {
  const sanitized = sanitizeCompactionContent(message.content)
  if (typeof sanitized === 'string') return sanitized.trim()
  return JSON.stringify(sanitized)
}

function promptStatus(messages: readonly ModelMessage[], userIndex: number): UserPromptLedgerEntry['status'] {
  const nextUserIndex = messages.findIndex((message, index) => index > userIndex && message.role === 'user')
  const endIndex = nextUserIndex >= 0 ? nextUserIndex : messages.length
  return messages.slice(userIndex + 1, endIndex).some((message) => message.role === 'assistant')
    ? 'completed'
    : 'open'
}

function sourceMessageId(sourceStartIndex: number, messageIndex: number) {
  return `model:${sourceStartIndex + messageIndex}`
}

export function extractUserPromptLedgerEntries(
  messages: readonly ModelMessage[],
  sourceStartIndex = 0,
) {
  return messages.flatMap((message, index): UserPromptLedgerEntry[] => {
    if (message.role !== 'user') return []
    const rawPrompt = promptContent(message)
    if (rawPrompt.length === 0) return []
    const prompt = rawPrompt.length <= MAX_LEDGER_PROMPT_CHARS
      ? rawPrompt
      : truncatePreservingEdges(rawPrompt, MAX_LEDGER_PROMPT_CHARS)
    return [{
      prompt: stripExecutionModeContext(prompt),
      sourceMessageIds: [sourceMessageId(sourceStartIndex, index)],
      status: promptStatus(messages, index),
      truncated: prompt !== rawPrompt,
    }]
  })
}

export function extractHistoricalUserPromptLedgerEntries(
  messages: readonly ModelMessage[],
  sourceStartIndex = 0,
) {
  const latestUserIndex = messages.findLastIndex((message) => message.role === 'user')
  return latestUserIndex >= 0
    ? extractUserPromptLedgerEntries(messages.slice(0, latestUserIndex), sourceStartIndex)
    : extractUserPromptLedgerEntries(messages, sourceStartIndex)
}

export function mergeUserPromptLedger(
  previous: readonly UserPromptLedgerEntry[],
  current: readonly UserPromptLedgerEntry[],
) {
  const merged = [...previous]
  for (const entry of current) {
    const statusUpgradeIndex = merged.findIndex((prior) => (
      prior.prompt === entry.prompt &&
      prior.status !== entry.status &&
      (prior.status === 'open' || prior.status === 'unknown') &&
      (entry.status === 'completed' || entry.status === 'aborted')
    ))
    if (statusUpgradeIndex >= 0) {
      merged[statusUpgradeIndex] = entry
      continue
    }

    if (!merged.some((prior) => JSON.stringify(prior) === JSON.stringify(entry))) {
      merged.push(entry)
    }
  }
  return merged
}

export function estimateUserPromptLedgerTokens(entries: readonly UserPromptLedgerEntry[]) {
  return approximateTokenCount(renderUserPromptLedger(entries))
}

export function selectNewestUserPromptLedger(
  entries: readonly UserPromptLedgerEntry[],
  maximumTokens: number,
) {
  if (entries.length === 0 || maximumTokens <= 0) return []

  const selected: UserPromptLedgerEntry[] = []
  let usedTokens = 0
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (!entry) continue
    const candidate = [entry, ...selected]
    const candidateTokens = estimateUserPromptLedgerTokens(candidate)
    if (candidateTokens <= maximumTokens) {
      selected.unshift(entry)
      usedTokens = candidateTokens
      continue
    }

    if (selected.length > 0 || usedTokens > 0) continue
    const boundedPrompt = truncatePreservingEdges(entry.prompt, Math.max(64, maximumTokens * 4))
    const boundedEntry = {
      ...entry,
      prompt: boundedPrompt,
      truncated: true,
    }
    if (estimateUserPromptLedgerTokens([boundedEntry]) <= maximumTokens) {
      selected.unshift(boundedEntry)
    }
    break
  }

  return selected
}

function removeExistingLedgerSection(summary: string) {
  const headingIndex = summary.indexOf(USER_PROMPT_LEDGER_HEADING)
  if (headingIndex < 0) return summary.trim()
  const before = summary.slice(0, headingIndex).trimEnd()
  const afterSection = summary.slice(headingIndex + USER_PROMPT_LEDGER_HEADING.length)
  const nextHeadingIndex = afterSection.search(/\n## /u)
  const after = nextHeadingIndex >= 0 ? afterSection.slice(nextHeadingIndex).trimStart() : ''
  return [before, after].filter(Boolean).join('\n\n').trim()
}

export function appendUserPromptLedgerToSummary(
  summary: string,
  entries: readonly UserPromptLedgerEntry[],
) {
  const withoutLedger = removeExistingLedgerSection(summary)
  const ledger = renderUserPromptLedger(entries)
  return [withoutLedger, ledger].filter(Boolean).join('\n\n').trim()
}
