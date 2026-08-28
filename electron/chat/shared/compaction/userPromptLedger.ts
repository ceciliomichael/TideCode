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

interface MergeUserPromptLedgerOptions {
  authoritativeOpenSourceMessageId?: string | null
}

function promptContent(message: ModelMessage) {
  const sanitized = sanitizeCompactionContent(message.content)
  if (typeof sanitized === 'string') return sanitized.trim()
  return JSON.stringify(sanitized)
}

function visibleAssistantText(message: ModelMessage) {
  if (message.role !== 'assistant') return ''
  if (typeof message.content === 'string') return message.content.trim()
  return message.content
    .filter((part): part is typeof part & { text: string; type: 'text' } => (
      typeof part === 'object' && part !== null && part.type === 'text' && typeof part.text === 'string'
    ))
    .map((part) => part.text)
    .join('\n')
    .trim()
}

function settledPromptStatus(
  messages: readonly ModelMessage[],
  userIndex: number,
  endIndex: number,
): UserPromptLedgerEntry['status'] {
  const finalAssistant = messages
    .slice(userIndex + 1, endIndex)
    .filter((message) => message.role === 'assistant')
    .at(-1)
  if (!finalAssistant) return 'open'

  const finalText = visibleAssistantText(finalAssistant)
  if (!finalText) return 'open'
  if (/\b(?:blocked|unfinished|incomplete|pending|unable\s+to|cannot|can't|could\s+not|couldn't|failed\s+to|did(?:n't|\s+not)\s+(?:complete|finish|verify|validate|test)|not\s+(?:done|complete|completed|finished|resolved|verified)|still\s+(?:need|needs|working)|remains?\s+(?:open|pending|unfinished|incomplete))\b/iu.test(finalText)) {
    return 'open'
  }
  return /\b(?:complete(?:d)?|done|finished|implemented|fixed|resolved|verified|passed|successful(?:ly)?)\b/iu.test(finalText)
    ? 'completed'
    : 'open'
}

function promptStatus(
  messages: readonly ModelMessage[],
  userIndex: number,
  sourceId: string,
  options?: UserPromptLedgerExtractionOptions,
): UserPromptLedgerEntry['status'] {
  const nextUserIndex = messages.findIndex((message, index) => index > userIndex && message.role === 'user')
  const endIndex = nextUserIndex >= 0 ? nextUserIndex : messages.length
  if (options?.latestUserSourceMessageId === sourceId) {
    return options.turnState === 'active'
      ? 'open'
      : settledPromptStatus(messages, userIndex, endIndex)
  }
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
      status: promptStatus(messages, index, sourceId, options),
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
  options?: MergeUserPromptLedgerOptions,
) {
  const merged = [...previous]
  for (const entry of current) {
    const authoritativeOpen = Boolean(
      options?.authoritativeOpenSourceMessageId &&
      entry.status === 'open' &&
      entry.sourceMessageIds.includes(options.authoritativeOpenSourceMessageId),
    )
    if (authoritativeOpen) {
      const activePromptIndex = merged.findLastIndex((prior) => prior.prompt === entry.prompt)
      if (activePromptIndex >= 0) {
        const prior = merged[activePromptIndex]
        merged[activePromptIndex] = {
          ...entry,
          sourceMessageIds: Array.from(new Set([...prior.sourceMessageIds, ...entry.sourceMessageIds])).slice(-8),
          truncated: prior.truncated || entry.truncated,
        }
        continue
      }
    }

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
