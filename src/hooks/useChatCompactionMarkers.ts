import { useEffect, useRef, useState } from 'react'
import { getVisibleChatCompactionMarkers } from '../lib/chatCompactionMarkerState'
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
  const markersByConversationRef = useRef<Map<string, ChatCompactionMarker[]>>(new Map())
  const [loadedMarkers, setLoadedMarkers] = useState<{
    conversationId: string | null
    markers: ChatCompactionMarker[]
  }>({
    conversationId: null,
    markers: [],
  })

  useEffect(() => {
    if (!conversationId) {
      setLoadedMarkers({ conversationId: null, markers: [] })
      return
    }

    let isCancelled = false
    const cachedMarkers = markersByConversationRef.current.get(conversationId) ?? []
    setLoadedMarkers({ conversationId, markers: cachedMarkers })

    const loadMarkers = async () => {
      try {
        const nextMarkers = await window.tidecodeHistory.listCompactionMarkers(conversationId)
        markersByConversationRef.current.set(conversationId, nextMarkers)
        if (!isCancelled) {
          setLoadedMarkers({ conversationId, markers: nextMarkers })
        }
      } catch (error) {
        console.error('Failed to load chat compaction markers', error)
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
  }, [conversationId, messagesLength, refreshSignal])

  return getVisibleChatCompactionMarkers(loadedMarkers, markersByConversationRef.current, conversationId)
}
