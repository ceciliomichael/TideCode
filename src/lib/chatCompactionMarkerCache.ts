import type { ChatCompactionMarker, Message } from '../types/chat'

const MAX_CACHED_CONVERSATION_MARKERS = 128
const markerCache = new Map<string, ChatCompactionMarker[]>()
const markerLoadPromises = new Map<string, Promise<ChatCompactionMarker[]>>()

function getCachedMarkers(conversationId: string) {
  const cachedMarkers = markerCache.get(conversationId)
  if (!cachedMarkers) return null
  markerCache.delete(conversationId)
  markerCache.set(conversationId, cachedMarkers)
  return cachedMarkers
}

function cacheMarkers(conversationId: string, markers: ChatCompactionMarker[]) {
  markerCache.delete(conversationId)
  markerCache.set(conversationId, markers)
  while (markerCache.size > MAX_CACHED_CONVERSATION_MARKERS) {
    const oldestConversationId = markerCache.keys().next().value
    if (typeof oldestConversationId !== 'string') break
    markerCache.delete(oldestConversationId)
  }
}

function normalizeConversationId(conversationId: string) {
  return conversationId.trim()
}

export function getCachedChatCompactionMarkers(conversationId: string | null) {
  const normalizedConversationId = conversationId?.trim() ?? ''
  if (normalizedConversationId.length === 0) {
    return null
  }

  return getCachedMarkers(normalizedConversationId)
}

export function loadChatCompactionMarkers(
  conversationId: string,
  options: { forceRefresh?: boolean } = {},
): Promise<ChatCompactionMarker[]> {
  const normalizedConversationId = normalizeConversationId(conversationId)
  if (normalizedConversationId.length === 0) {
    return Promise.resolve([])
  }

  const inFlightLoad = markerLoadPromises.get(normalizedConversationId)
  if (inFlightLoad && !options.forceRefresh) {
    return inFlightLoad
  }

  if (!options.forceRefresh) {
    const cachedMarkers = getCachedMarkers(normalizedConversationId)
    if (cachedMarkers) {
      return Promise.resolve(cachedMarkers)
    }
  }

  const loadPromise = Promise.resolve()
    .then(() => window.tidecodeHistory.listCompactionMarkers(normalizedConversationId))
    .then((markers) => {
      if (markerLoadPromises.get(normalizedConversationId) === loadPromise) {
        cacheMarkers(normalizedConversationId, markers)
      }
      return markers
    })
    .finally(() => {
      if (markerLoadPromises.get(normalizedConversationId) === loadPromise) {
        markerLoadPromises.delete(normalizedConversationId)
      }
    })

  markerLoadPromises.set(normalizedConversationId, loadPromise)
  return loadPromise
}

export function clearCachedChatCompactionMarkers(conversationId: string) {
  const normalizedConversationId = normalizeConversationId(conversationId)
  if (normalizedConversationId.length > 0) {
    markerCache.delete(normalizedConversationId)
  }
}

/** Apply an edited branch boundary before its replacement bubble is painted. */
export function discardCachedCompactionMarkersFromMessage(
  conversationId: string,
  messages: readonly Message[],
  messageId: string,
) {
  const normalizedConversationId = normalizeConversationId(conversationId)
  const targetIndex = messages.findIndex((message) => message.id === messageId && message.role === 'user')
  if (!normalizedConversationId || targetIndex < 0) return

  const target = messages[targetIndex]
  const earlierUserIds = new Set(messages.slice(0, targetIndex)
    .filter((message) => message.role === 'user')
    .map((message) => message.id))
  const retained = (markerCache.get(normalizedConversationId) ?? []).filter((marker) => (
    marker.anchorUserMessageId !== null &&
    earlierUserIds.has(marker.anchorUserMessageId) &&
    marker.createdAt <= target.timestamp
  ))
  // A load started on the discarded branch must not repopulate the cache.
  markerLoadPromises.delete(normalizedConversationId)
  cacheMarkers(normalizedConversationId, retained)
}
