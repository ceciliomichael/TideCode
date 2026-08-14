import type { ModelMessage } from 'ai'
import type { LocalCompactionPacketV2 } from './contracts'
import { buildContinuationMessage, isCompactionContinuationMessage } from './markdown'
import {
  sanitizeCompactedModelContent,
  sanitizeCompactedModelMessages,
} from '../modelMessageIntegrity'
import { DEFAULT_CONTEXT_COMPACTION_RETAINED_TOKENS } from '../../../../src/lib/contextCompactionSettings'
import { selectLatestContextByTokens } from './retention'

function sanitizeProjectedMessage(message: ModelMessage): ModelMessage {
  return {
    ...message,
    content: sanitizeCompactedModelContent(message.content),
  } as ModelMessage
}

export interface CompactionProjectionInput {
  anchorMessages: readonly ModelMessage[]
  packet: LocalCompactionPacketV2
  tailMessages: readonly ModelMessage[]
  retainedContextTokens?: number
}

export function buildCompactionProjection(input: CompactionProjectionInput) {
  const selectedTail = selectLatestContextByTokens(
    input.tailMessages,
    input.retainedContextTokens ?? DEFAULT_CONTEXT_COMPACTION_RETAINED_TOKENS,
  ).messages
  const tail = selectedTail
    .map(sanitizeProjectedMessage)
    .filter((message) => !isCompactionContinuationMessage(message, input.packet.continuationMarkdown))
  return sanitizeCompactedModelMessages([
    // The AI-generated summary is the new beginning of provider history. The
    // original messages remain in durable display history and are not replayed
    // before this carried-forward summary.
    buildContinuationMessage(input.packet.continuationMarkdown),
    ...tail,
  ])
}

export const projectCompactionPacket = buildCompactionProjection
