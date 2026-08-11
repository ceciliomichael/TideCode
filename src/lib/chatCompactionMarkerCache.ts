import type { ChatCompactionMarker } from '../types/chat'

const markerCache = new Map<string, ChatCompactionMarker[]>()
const markerLoadPromises = new Map<string, Promise<ChatCompactionMarker[]>>()

function normalizeConversationId(conversationId: string) {
  return conversationId.trim()
}

export function getCachedChatCompactionMarkers(conversationId: string | null) {
  const normalizedConversationId = conversationId?.trim() ?? ''
  if (normalizedConversationId.length === 0) {
    return null
  }

  return markerCache.get(normalizedConversationId) ?? null
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
    const cachedMarkers = markerCache.get(normalizedConversationId)
    if (cachedMarkers) {
      return Promise.resolve(cachedMarkers)
    }
  }

  const loadPromise = Promise.resolve()
    .then(() => window.tidecodeHistory.listCompactionMarkers(normalizedConversationId))
    .then((markers) => {
      if (markerLoadPromises.get(normalizedConversationId) === loadPromise) {
        markerCache.set(normalizedConversationId, markers)
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

export async function prefetchChatCompactionMarkers(conversationIds: readonly string[]) {
  const uniqueConversationIds = Array.from(
    new Set(conversationIds.map(normalizeConversationId).filter((conversationId) => conversationId.length > 0)),
  )

  await Promise.allSettled(uniqueConversationIds.map((conversationId) => loadChatCompactionMarkers(conversationId)))
}
