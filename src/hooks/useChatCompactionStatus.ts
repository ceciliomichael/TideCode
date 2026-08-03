import { useEffect, useState } from 'react'
import { reduceChatCompactionStatus } from '../lib/chatCompactionStatus'
import type { ChatCompactionLifecycleState } from '../types/chat'

interface UseChatCompactionStatusInput {
  conversationId: string | null
  persistedCompactionIds?: readonly string[]
}

export function useChatCompactionStatus({
  conversationId,
  persistedCompactionIds = [],
}: UseChatCompactionStatusInput): ChatCompactionLifecycleState | null {
  const [status, setStatus] = useState<ChatCompactionLifecycleState | null>(null)

  useEffect(() => {
    if (!conversationId) {
      setStatus(null)
      return
    }

    const unsubscribe = window.tidecodeChat.onStreamEvent((event) => {
      setStatus((currentStatus) => reduceChatCompactionStatus(currentStatus, event, conversationId))
    })

    return unsubscribe
  }, [conversationId])

  useEffect(() => {
    if (
      status?.phase === 'compacted' &&
      persistedCompactionIds.includes(status.compactionId)
    ) {
      setStatus(null)
    }
  }, [persistedCompactionIds, status])

  return status
}
