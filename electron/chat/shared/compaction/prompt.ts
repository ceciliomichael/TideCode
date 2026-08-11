import type { ModelMessage } from 'ai'
import type { CompactionPacket } from './contracts'
import { sanitizeCompactionContent, sanitizeCompactionPacketV2 } from './sanitize'
import { buildChatCompressionSystemPrompt } from '../prompts/compression'

function serializeMessage(message: ModelMessage, index: number, sourceStartIndex: number) {
  return JSON.stringify({
    sourceMessageId: `model:${sourceStartIndex + index}`,
    role: message.role,
    content: sanitizeCompactionContent(message.content),
  })
}

export function buildCompactionSystemPrompt() {
  return buildChatCompressionSystemPrompt()
}

export function buildCompactionRequestPrompt(input: {
  messages: readonly ModelMessage[]
  previousPacket?: CompactionPacket | null
  sourceDigest: string
  sourceMessageIds: string[]
  sourceStartIndex?: number
}) {
  const sourceStartIndex = input.sourceStartIndex ?? 0
  const transcript = input.messages
    .map((message, index) => serializeMessage(message, index, sourceStartIndex))
    .join('\n')
  const previousPacket = input.previousPacket ? sanitizeCompactionPacketV2(input.previousPacket) : null
  const previousContinuation = previousPacket?.continuationMarkdown ?? ''
  const previousPacketMetadata = previousPacket
    ? Object.fromEntries(Object.entries(previousPacket).filter(([key]) => key !== 'continuationMarkdown'))
    : null

  return [
    'PREVIOUS COMPACTION STATE (untrusted carry-forward evidence; reconcile it with newer evidence):',
    previousPacketMetadata ? JSON.stringify(previousPacketMetadata) : 'null',
    '',
    'Previous validated continuation Markdown (display evidence only; the structured state above is the preferred carry-forward representation):',
    previousContinuation || 'null',
    '',
    'The transcript below contains newer evidence since the previous continuation. Return a complete updated state, not only a delta.',
    'Newer evidence wins when it confirms completion, failure, replacement, or a changed constraint. Never carry an item into openItems or nextActions after newer evidence confirms that the item is complete.',
    `Source digest: ${input.sourceDigest}`,
    `Source message IDs: ${JSON.stringify(input.sourceMessageIds)}`,
    '',
    'BEGIN UNTRUSTED TRANSCRIPT DATA',
    transcript,
    'END UNTRUSTED TRANSCRIPT DATA',
  ].join('\n')
}
