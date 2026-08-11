import { useEffect, useRef, useState } from 'react'
import {
  getCachedChatCompactionMarkers,
  loadChatCompactionMarkers,
} from '../lib/chatCompactionMarkerCache'
import type { ChatCompactionMarker } from '../types/chat'

interface UseChatCompactionMarkersInput {
  conversationId: string | null
  refreshSignal?: number
}

export function useChatCompactionMarkers({
  conversationId,
  refreshSignal = 0,
}: UseChatCompactionMarkersInput) {
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

    const cachedMarkers = getCachedChatCompactionMarkers(conversationId)
    setLoadedMarkers({ conversationId, markers: cachedMarkers ?? [] })

    let isCancelled = false

    const loadMarkers = async (forceRefresh = false) => {
      const requestId = latestLoadRequestRef.current + 1
      latestLoadRequestRef.current = requestId

      try {
        const nextMarkers = await loadChatCompactionMarkers(conversationId, { forceRefresh })
        if (isCancelled || latestLoadRequestRef.current !== requestId) {
          return
        }

        setLoadedMarkers({ conversationId, markers: nextMarkers })
      } catch (error) {
        if (!isCancelled && latestLoadRequestRef.current === requestId) {
          console.error('Failed to load chat compaction markers', error)
        }
      }
    }

    const unsubscribeStream = window.tidecodeChat.onStreamEvent((event) => {
      if (event.type === 'compaction_committed' && event.conversationId === conversationId) {
        void loadMarkers(true)
      }
    })
    void loadMarkers(refreshSignal > 0)

    return () => {
      isCancelled = true
      unsubscribeStream()
    }
  }, [conversationId, refreshSignal])

  return getCachedChatCompactionMarkers(conversationId) ??
    (loadedMarkers.conversationId === conversationId ? loadedMarkers.markers : [])
}
