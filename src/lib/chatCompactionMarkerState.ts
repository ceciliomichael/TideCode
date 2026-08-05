import type { ChatCompactionMarker } from '../types/chat'

export interface ChatCompactionMarkerViewState {
  conversationId: string | null
  markers: ChatCompactionMarker[]
}

export function getVisibleChatCompactionMarkers(
  loadedState: ChatCompactionMarkerViewState,
  markersByConversation: ReadonlyMap<string, ChatCompactionMarker[]>,
  conversationId: string | null,
) {
  if (loadedState.conversationId === conversationId) {
    return loadedState.markers
  }

  return conversationId ? markersByConversation.get(conversationId) ?? [] : []
}
