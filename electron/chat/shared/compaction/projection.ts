import type { ModelMessage } from 'ai'
import type { LocalCompactionPacketV2 } from './contracts'
import { buildContinuationMessage, isCompactionContinuationMessage } from './markdown'
import {
  sanitizeCompactedModelContent,
  sanitizeCompactedModelMessages,
} from '../modelMessageIntegrity'
import {
  DEFAULT_COMPACTION_RETAINED_TURNS,
  selectLatestConversationTurns,
} from './turns'

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
  retainedTurnCount?: number
}

export function buildCompactionProjection(input: CompactionProjectionInput) {
  const tail = selectLatestConversationTurns(
    input.tailMessages
      .map(sanitizeProjectedMessage)
      .filter((message) => !isCompactionContinuationMessage(message, input.packet.continuationMarkdown)),
    input.retainedTurnCount ?? DEFAULT_COMPACTION_RETAINED_TURNS,
  )
  return sanitizeCompactedModelMessages([
    // The AI-generated summary is the new beginning of provider history. The
    // original messages remain in durable display history and are not replayed
    // before this carried-forward summary.
    buildContinuationMessage(input.packet.continuationMarkdown),
    ...tail,
  ])
}

export const projectCompactionPacket = buildCompactionProjection
