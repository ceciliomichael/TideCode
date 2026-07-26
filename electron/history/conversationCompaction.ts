import type { ConversationCompaction, ConversationRecord } from '../../src/types/chat'

export function buildConversationCompaction(
  sourceConversation: ConversationRecord,
  conversations: readonly ConversationRecord[],
  compactedAt = Date.now(),
): ConversationCompaction {
  const rootConversationId =
    sourceConversation.compaction?.rootConversationId ?? sourceConversation.id
  const latestSequence = conversations.reduce((highestSequence, conversation) => {
    if (conversation.compaction?.rootConversationId !== rootConversationId) {
      return highestSequence
    }

    return Math.max(highestSequence, conversation.compaction.sequence)
  }, 0)

  return {
    compactedAt,
    depth: (sourceConversation.compaction?.depth ?? 0) + 1,
    rootConversationId,
    sequence: latestSequence + 1,
    sourceConversationId: sourceConversation.id,
  }
}
