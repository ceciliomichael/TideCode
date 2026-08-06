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
      if (marker.anchorUserMessageId) {
        continue
      }
      trailingMarkers.push(marker)
      continue
    }

    const firstPostCompactionMessage = visibleMessages
      .slice(anchorIndex + 1)
      .find((message) => message.timestamp > marker.createdAt)

    const nextTranscriptMessage = firstPostCompactionMessage ?? visibleMessages
      .slice(anchorIndex + 1)
      .find((message) => message.role === 'user')

    if (!nextTranscriptMessage) {
      trailingMarkers.push(marker)
      continue
    }

    const anchoredMarkers = markersBeforeMessageId.get(nextTranscriptMessage.id) ?? []
    anchoredMarkers.push(marker)
    markersBeforeMessageId.set(nextTranscriptMessage.id, anchoredMarkers)
  }

  return {
    markersBeforeMessageId,
    trailingMarkers,
  }
}
