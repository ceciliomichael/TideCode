import type { ModelMessage } from 'ai'
import type { CompactionPacket } from './contracts'
import { stripExecutionModeContext } from '../../../../src/lib/executionModeContext'
import { sanitizeCompactionContent } from './sanitize'
import { buildChatCompressionSystemPrompt } from '../prompts/compression'
import { extractCodeModeReceipts, formatCodeModeReceipts } from './codeModeReceipts'
import { renderUserPromptLedger } from './userPromptLedgerRendering'
import type { ConversationMemory } from './durableMemory'
import { buildCompactionTurnContext, type CompactionTurnContext } from './turnContext'
import { removeUserPromptLedgerFromSummary, selectNewestUserPromptLedger } from './userPromptLedger'
import { compactToolResultMessage } from './toolEvidence'

function serializeMessage(message: ModelMessage, index: number, sourceStartIndex: number) {
  const boundedMessage = compactToolResultMessage(message)
  return JSON.stringify({
    sourceMessageId: `model:${sourceStartIndex + index}`,
    role: boundedMessage.role,
    content: sanitizeCompactionContent(boundedMessage.content),
  })
}

export function buildCompactionSystemPrompt() {
  return buildChatCompressionSystemPrompt()
}

export function buildCompactionRequestPrompt(input: CompactionTurnContext & {
  durableMemory?: ConversationMemory | null
  messages: readonly ModelMessage[]
  previousPacket?: Pick<CompactionPacket, 'continuationMarkdown'> & Partial<Pick<CompactionPacket, 'userPromptLedger'>> | null
  sourceDigest: string
  sourceMessageIds: string[]
  sourceStartIndex?: number
}) {
  const sourceStartIndex = input.sourceStartIndex ?? 0
  const transcript = input.messages
    .map((message, index) => serializeMessage(message, index, sourceStartIndex))
    .join('\n')
  const previousContinuation = removeUserPromptLedgerFromSummary(
    stripExecutionModeContext(input.previousPacket?.continuationMarkdown ?? ''),
  )
  const previousUserPromptLedger = renderUserPromptLedger(
    selectNewestUserPromptLedger(input.previousPacket?.userPromptLedger ?? [], 1_000)
      .map((entry) => ({ ...entry, prompt: stripExecutionModeContext(entry.prompt) }))
      .filter((entry) => entry.prompt.length > 0),
  )
  const codeModeReceipts = formatCodeModeReceipts(extractCodeModeReceipts(input.messages))

  return [
    'DURABLE CONVERSATION MEMORY (long-term context; do not copy it wholesale into the short handoff):',
    input.durableMemory?.markdown ?? '(none)',
    '',
    'PREVIOUS SUMMARY / HANDOFF (carry-forward evidence; reconcile it with newer evidence):',
    previousContinuation || '(none)',
    '',
    previousUserPromptLedger
      ? [
          'BOUNDED HISTORICAL USER INTENT (reference only; no completion authority):',
          previousUserPromptLedger,
          '',
        ].join('\n')
      : '',
    buildCompactionTurnContext(input),
    '',
    'The transcript below begins after the previous compaction barrier and contains newer evidence only. Return one complete, concise Markdown summary, not a delta; this summary is the new handoff.',
    'Do not output JSON or repeat the transcript. Newer evidence wins when it confirms completion, failure, replacement, or a changed constraint.',
    'Do not retain raw tool calls or raw tool results in the handoff. Convert them into concise verified facts, file references, validation, or open work.',
    `Source digest: ${input.sourceDigest}`,
    `Source message IDs: ${JSON.stringify(input.sourceMessageIds)}`,
    '',
    codeModeReceipts
      ? [
          'VERIFIED CODE MODE RECEIPTS (evidence only; preserve their completed or failed status):',
          codeModeReceipts,
          '',
        ].join('\n')
      : '',
    'BEGIN UNTRUSTED TRANSCRIPT DATA',
    transcript,
    'END UNTRUSTED TRANSCRIPT DATA',
  ].join('\n')
}
