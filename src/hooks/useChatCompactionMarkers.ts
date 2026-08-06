import { useEffect, useRef, useState } from 'react'
import { getVisibleChatCompactionMarkers } from '../lib/chatCompactionMarkerState'
import type { ChatCompactionMarker } from '../types/chat'

interface UseChatCompactionMarkersInput {
  conversationId: string | null
  messagesRevision: string
  refreshSignal?: number
}

export function useChatCompactionMarkers({
  conversationId,
  messagesRevision,
  refreshSignal = 0,
}: UseChatCompactionMarkersInput) {
  const markersByConversationRef = useRef<Map<string, ChatCompactionMarker[]>>(new Map())
  const latestLoadRequestRef = useRef(0)
  const [loadedMarkers, setLoadedMarkers] = useState<{
    conversationId: string | null
    markers: ChatCompactionMarker[]
  }>({
    conversationId: null,
    markers: [],
  })

  useEffect(() => {
    if (!conversationId) {
      latestLoadRequestRef.current += 1
      setLoadedMarkers({ conversationId: null, markers: [] })
      return
    }

    markersByConversationRef.current.delete(conversationId)
    setLoadedMarkers({ conversationId, markers: [] })

    let isCancelled = false

    const loadMarkers = async () => {
      const requestId = latestLoadRequestRef.current + 1
      latestLoadRequestRef.current = requestId

      try {
        const nextMarkers = await window.tidecodeHistory.listCompactionMarkers(conversationId)
        if (isCancelled || latestLoadRequestRef.current !== requestId) {
          return
        }

        markersByConversationRef.current.set(conversationId, nextMarkers)
        setLoadedMarkers({ conversationId, markers: nextMarkers })
      } catch (error) {
        if (!isCancelled && latestLoadRequestRef.current === requestId) {
          console.error('Failed to load chat compaction markers', error)
        }
      }
    }

    const unsubscribeStream = window.tidecodeChat.onStreamEvent((event) => {
      if (event.type === 'compaction_committed' && event.conversationId === conversationId) {
        void loadMarkers()
      }
    })
    void loadMarkers()

    return () => {
      isCancelled = true
      unsubscribeStream()
    }
  }, [conversationId, messagesRevision, refreshSignal])

  return getVisibleChatCompactionMarkers(loadedMarkers, markersByConversationRef.current, conversationId)
}
