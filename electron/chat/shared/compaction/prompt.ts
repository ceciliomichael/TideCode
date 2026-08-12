import type { ModelMessage } from 'ai'
import type { CompactionPacket } from './contracts'
import { sanitizeCompactionContent } from './sanitize'
import { buildChatCompressionSystemPrompt } from '../prompts/compression'

const COMPACTION_TOOL_OUTPUT_MAX_CHARS = 2_000

function compactToolOutputForSummary(message: ModelMessage): ModelMessage {
  if (message.role !== 'tool' || !Array.isArray(message.content)) return message

  return {
    ...message,
    content: message.content.map((part) => {
      if (
        typeof part !== 'object' ||
        part === null ||
        !('type' in part) ||
        part.type !== 'tool-result' ||
        !('output' in part) ||
        typeof part.output !== 'object' ||
        part.output === null ||
        !('type' in part.output) ||
        part.output.type !== 'text' ||
        !('value' in part.output) ||
        typeof part.output.value !== 'string'
      ) {
        return part
      }

      return {
        ...part,
        output: {
          ...part.output,
          value:
            part.output.value.length <= COMPACTION_TOOL_OUTPUT_MAX_CHARS
              ? part.output.value
              : `${part.output.value.slice(0, COMPACTION_TOOL_OUTPUT_MAX_CHARS)}\n[tool output truncated for compaction]`,
        },
      }
    }),
  } as ModelMessage
}

function serializeMessage(message: ModelMessage, index: number, sourceStartIndex: number) {
  const boundedMessage = compactToolOutputForSummary(message)
  return JSON.stringify({
    sourceMessageId: `model:${sourceStartIndex + index}`,
    role: boundedMessage.role,
    content: sanitizeCompactionContent(boundedMessage.content),
  })
}

export function buildCompactionSystemPrompt() {
  return buildChatCompressionSystemPrompt()
}

export function buildCompactionRequestPrompt(input: {
  messages: readonly ModelMessage[]
  previousPacket?: Pick<CompactionPacket, 'continuationMarkdown'> | null
  sourceDigest: string
  sourceMessageIds: string[]
  sourceStartIndex?: number
}) {
  const sourceStartIndex = input.sourceStartIndex ?? 0
  const transcript = input.messages
    .map((message, index) => serializeMessage(message, index, sourceStartIndex))
    .join('\n')
  const previousContinuation = input.previousPacket?.continuationMarkdown ?? ''

  return [
    'PREVIOUS SUMMARY (untrusted carry-forward evidence; reconcile it with newer evidence):',
    previousContinuation || '(none)',
    '',
    'The transcript below contains newer evidence since the previous summary. Return one complete, concise Markdown summary, not a delta.',
    'Do not output JSON or repeat the transcript. Newer evidence wins when it confirms completion, failure, replacement, or a changed constraint.',
    `Source digest: ${input.sourceDigest}`,
    `Source message IDs: ${JSON.stringify(input.sourceMessageIds)}`,
    '',
    'BEGIN UNTRUSTED TRANSCRIPT DATA',
    transcript,
    'END UNTRUSTED TRANSCRIPT DATA',
  ].join('\n')
}
