import { useEffect, useState } from 'react'
import { reduceChatCompactionStatus } from '../lib/chatCompactionStatus'
import type { ChatCompactionLifecycleState } from '../types/chat'

interface UseChatCompactionStatusInput {
  conversationId: string | null
}

export function useChatCompactionStatus({
  conversationId,
}: UseChatCompactionStatusInput): ChatCompactionLifecycleState | null {
  const [statusState, setStatusState] = useState<{
    conversationId: string | null
    status: ChatCompactionLifecycleState | null
  }>({
    conversationId: null,
    status: null,
  })

  useEffect(() => {
    setStatusState({ conversationId, status: null })
    if (!conversationId) {
      return
    }

    let cancelled = false
    void window.tidecodeRuns.getCompactionState(conversationId)
      .then((status) => {
        if (!cancelled) setStatusState({ conversationId, status })
      })
      .catch(() => undefined)

    const unsubscribe = window.tidecodeChat.onStreamEvent((event) => {
      setStatusState((currentState) => {
        if (currentState.conversationId !== conversationId) {
          return currentState
        }

        return {
          conversationId,
          status: reduceChatCompactionStatus(currentState.status, event, conversationId),
        }
      })
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [conversationId])

  return statusState.conversationId === conversationId ? statusState.status : null
}
