import type { ChatCompactionMarker, Message } from '../../types/chat'

export interface CompactionMarkerPlacement {
  markersBeforeMessageId: ReadonlyMap<string, ChatCompactionMarker[]>
  trailingMarkers: ChatCompactionMarker[]
}

export function placeCompactionMarkersAfterTranscript(
  visibleMessages: readonly Message[],
  markers: readonly ChatCompactionMarker[],
): CompactionMarkerPlacement {
  const messageIndexById = new Map(visibleMessages.map((message, index) => [message.id, index]))
  const markersBeforeMessageId = new Map<string, ChatCompactionMarker[]>()
  const trailingMarkers: ChatCompactionMarker[] = []

  for (const marker of markers) {
    const anchorIndex = marker.anchorUserMessageId
      ? messageIndexById.get(marker.anchorUserMessageId)
      : undefined
    if (anchorIndex === undefined) {
      trailingMarkers.push(marker)
      continue
    }

    const nextUserMessage = visibleMessages
      .slice(anchorIndex + 1)
      .find((message) => message.role === 'user')
    if (!nextUserMessage) {
      trailingMarkers.push(marker)
      continue
    }

    const anchoredMarkers = markersBeforeMessageId.get(nextUserMessage.id) ?? []
    anchoredMarkers.push(marker)
    markersBeforeMessageId.set(nextUserMessage.id, anchoredMarkers)
  }

  return {
    markersBeforeMessageId,
    trailingMarkers,
  }
}
