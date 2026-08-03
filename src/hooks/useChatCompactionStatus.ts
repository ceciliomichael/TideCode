import { useEffect, useState } from 'react'
import { reduceChatCompactionStatus } from '../lib/chatCompactionStatus'
import type { ChatCompactionLifecycleState } from '../types/chat'

interface UseChatCompactionStatusInput {
  conversationId: string | null
}

export function useChatCompactionStatus({
  conversationId,
}: UseChatCompactionStatusInput): ChatCompactionLifecycleState | null {
  const [status, setStatus] = useState<ChatCompactionLifecycleState | null>(null)

  useEffect(() => {
    setStatus(null)
    if (!conversationId) {
      return
    }

    const unsubscribe = window.tidecodeChat.onStreamEvent((event) => {
      setStatus((currentStatus) => reduceChatCompactionStatus(currentStatus, event, conversationId))
    })

    return unsubscribe
  }, [conversationId])

  return status
}
