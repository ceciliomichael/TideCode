import type { ChatCompactionMarker, Message } from '../../types/chat'

export interface CompactionMarkerPlacement {
  markersBeforeMessageId: ReadonlyMap<string, ChatCompactionMarker[]>
  trailingMarkers: ChatCompactionMarker[]
}

export function placeCompactionMarkersAfterTranscript(
  visibleMessages: readonly Message[],
  markers: readonly ChatCompactionMarker[],
  options: { preferredMessageId?: string | null } = {},
): CompactionMarkerPlacement {
  const messageIndexById = new Map(visibleMessages.map((message, index) => [message.id, index]))
  const markersBeforeMessageId = new Map<string, ChatCompactionMarker[]>()
  const trailingMarkers: ChatCompactionMarker[] = []
  const preferredMessageIndex = options.preferredMessageId
    ? messageIndexById.get(options.preferredMessageId)
    : undefined

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

    const preferredMessage = preferredMessageIndex !== undefined && preferredMessageIndex > anchorIndex
      ? visibleMessages[preferredMessageIndex]
      : undefined
    const targetMessage = firstPostCompactionMessage ?? nextTranscriptMessage ?? preferredMessage

    if (!targetMessage) {
      trailingMarkers.push(marker)
      continue
    }

    const anchoredMarkers = markersBeforeMessageId.get(targetMessage.id) ?? []
    anchoredMarkers.push(marker)
    markersBeforeMessageId.set(targetMessage.id, anchoredMarkers)
  }

  return {
    markersBeforeMessageId,
    trailingMarkers,
  }
}
