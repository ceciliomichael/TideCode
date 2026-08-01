import { useEffect, useState } from 'react'
import type { ChatCompactionMarker } from '../types/chat'

interface UseChatCompactionMarkersInput {
  conversationId: string | null
  messagesLength: number
  refreshSignal?: number
}

export function useChatCompactionMarkers({
  conversationId,
  messagesLength,
  refreshSignal = 0,
}: UseChatCompactionMarkersInput) {
  const [markers, setMarkers] = useState<ChatCompactionMarker[]>([])

  useEffect(() => {
    if (!conversationId) {
      setMarkers([])
      return
    }

    let isCancelled = false
    const timeoutId = window.setTimeout(() => {
      void window.tidecodeHistory
        .listCompactionMarkers(conversationId)
        .then((nextMarkers) => {
          if (!isCancelled) {
            setMarkers(nextMarkers)
          }
        })
        .catch((error) => {
          console.error('Failed to load chat compaction markers', error)
        })
    }, 100)

    return () => {
      isCancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [conversationId, messagesLength, refreshSignal])

  return markers
}
