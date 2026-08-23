import type {
  ChatCompactionLifecycleState,
  ChatStreamEvent,
} from '../types/chat'

export function reduceChatCompactionStatus(
  currentStatus: ChatCompactionLifecycleState | null,
  event: ChatStreamEvent,
  conversationId: string,
): ChatCompactionLifecycleState | null {
  if ('conversationId' in event && event.conversationId !== conversationId) {
    return currentStatus
  }

  if (event.type === 'compaction_started') {
    return {
      afterMessageId: event.afterMessageId ?? null,
      attemptId: event.attemptId,
      phase: 'compacting',
      streamId: event.streamId,
    }
  }

  if (event.type === 'compaction_committed') {
    const matchingStatus = currentStatus?.streamId === event.streamId ? currentStatus : null
    return {
      afterMessageId: event.afterMessageId ?? matchingStatus?.afterMessageId ?? null,
      attemptId: matchingStatus?.attemptId ?? event.compactionId,
      compactionId: event.compactionId,
      phase: 'compacted',
      streamId: event.streamId,
    }
  }

  if (event.type === 'compaction_failed') {
    return currentStatus?.attemptId === event.attemptId ? null : currentStatus
  }

  if (event.type === 'completed' || event.type === 'aborted' || event.type === 'error') {
    return currentStatus?.streamId === event.streamId && currentStatus.phase === 'compacting'
      ? null
      : currentStatus
  }

  return currentStatus
}
