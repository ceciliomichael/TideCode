import type { ModelMessage } from 'ai'
import { approximateTokenCount } from '../../../../src/lib/contextUsage'
import { stripExecutionModeContext } from '../../../../src/lib/executionModeContext'
import { sanitizeCompactionContent } from './sanitize'
import { truncatePreservingEdges } from './codeModeProjection'
import type { CompactionTurnState, UserPromptLedgerEntry } from './contracts'
import { renderUserPromptLedger, USER_PROMPT_LEDGER_HEADING } from './userPromptLedgerRendering'
const MAX_LEDGER_PROMPT_CHARS = 16_000

interface UserPromptLedgerExtractionOptions {
  latestUserSourceMessageId?: string | null
  turnState?: CompactionTurnState
}

function promptContent(message: ModelMessage) {
  const sanitized = sanitizeCompactionContent(message.content)
  if (typeof sanitized === 'string') return sanitized.trim()
  return JSON.stringify(sanitized)
}

function promptStatus(
  sourceId: string,
  options?: UserPromptLedgerExtractionOptions,
): UserPromptLedgerEntry['status'] {
  if (options?.latestUserSourceMessageId === sourceId && options.turnState === 'active') {
    return 'open'
  }
  return 'unknown'
}

function sourceMessageId(sourceStartIndex: number, messageIndex: number) {
  return `model:${sourceStartIndex + messageIndex}`
}

export function extractUserPromptLedgerEntries(
  messages: readonly ModelMessage[],
  sourceStartIndex = 0,
  options?: UserPromptLedgerExtractionOptions,
) {
  return messages.flatMap((message, index): UserPromptLedgerEntry[] => {
    if (message.role !== 'user') return []
    const rawPrompt = promptContent(message)
    if (rawPrompt.length === 0) return []
    const prompt = rawPrompt.length <= MAX_LEDGER_PROMPT_CHARS
      ? rawPrompt
      : truncatePreservingEdges(rawPrompt, MAX_LEDGER_PROMPT_CHARS)
    const sourceId = sourceMessageId(sourceStartIndex, index)
    return [{
      prompt: stripExecutionModeContext(prompt),
      sourceMessageIds: [sourceId],
      status: promptStatus(sourceId, options),
      truncated: prompt !== rawPrompt,
    }]
  })
}

export function mergeUserPromptLedger(
  previous: readonly UserPromptLedgerEntry[],
  current: readonly UserPromptLedgerEntry[],
) {
  const merged: UserPromptLedgerEntry[] = []
  for (const entry of [...previous, ...current]) {
    // Only a fresh extraction can establish runtime-open state. Older status
    // labels are not evidence that a user goal succeeded or remains unfinished.
    const status = current.includes(entry) && entry.status === 'open' ? 'open' : 'unknown'
    const priorIndex = merged.findIndex((prior) => prior.prompt === entry.prompt)
    if (priorIndex >= 0) {
      const prior = merged[priorIndex]
      merged.splice(priorIndex, 1)
      merged.push({
        ...entry,
        sourceMessageIds: Array.from(new Set([...prior.sourceMessageIds, ...entry.sourceMessageIds])).slice(-8),
        status,
        truncated: prior.truncated || entry.truncated,
      })
    } else {
      merged.push({ ...entry, status })
    }
  }
  return merged.slice(-128)
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

export function removeUserPromptLedgerFromSummary(summary: string) {
  const headingIndex = summary.indexOf(USER_PROMPT_LEDGER_HEADING)
  if (headingIndex < 0) return summary.trim()
  const before = summary.slice(0, headingIndex).trimEnd()
  const afterSection = summary.slice(headingIndex + USER_PROMPT_LEDGER_HEADING.length)
  const nextHeadingIndex = afterSection.search(/\n## /u)
  const after = nextHeadingIndex >= 0 ? afterSection.slice(nextHeadingIndex).trimStart() : ''
  return [before, after].filter(Boolean).join('\n\n').trim()
}
