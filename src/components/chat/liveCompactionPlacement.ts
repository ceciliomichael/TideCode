import type { ChatCompactionLifecycleState, Message } from '../../types/chat'

export interface LiveCompactionPlacement {
  beforeMessageId: string | null
  trailing: boolean
}

export function resolveLiveCompactionPlacement(
  visibleMessages: readonly Message[],
  liveCompaction: ChatCompactionLifecycleState | null,
): LiveCompactionPlacement | null {
  if (!liveCompaction) {
    return null
  }

  const afterMessageId = liveCompaction.afterMessageId
  if (!afterMessageId) {
    return { beforeMessageId: null, trailing: true }
  }

  const boundaryIndex = visibleMessages.findIndex((message) => message.id === afterMessageId)
  if (boundaryIndex < 0 || boundaryIndex >= visibleMessages.length - 1) {
    return { beforeMessageId: null, trailing: true }
  }

  return {
    beforeMessageId: visibleMessages[boundaryIndex + 1].id,
    trailing: false,
  }
}
