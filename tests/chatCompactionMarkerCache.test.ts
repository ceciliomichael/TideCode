import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCachedChatCompactionMarkers,
  loadChatCompactionMarkers,
  discardCachedCompactionMarkersFromMessage,
} from '../src/lib/chatCompactionMarkerCache'
import type { ChatCompactionMarker, Message } from '../src/types/chat'

interface Deferred<T> {
  promise: Promise<T>
  reject: (error: unknown) => void
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function installTestWindow(listCompactionMarkers: (conversationId: string) => Promise<ChatCompactionMarker[]>) {
  const globalWithWindow = globalThis as typeof globalThis & {
    window?: {
      tidecodeHistory: {
        listCompactionMarkers: typeof listCompactionMarkers
      }
    }
  }
  const previousWindow = globalWithWindow.window
  globalWithWindow.window = {
    tidecodeHistory: { listCompactionMarkers },
  }

  return () => {
    if (previousWindow === undefined) {
      delete globalWithWindow.window
      return
    }

    globalWithWindow.window = previousWindow
  }
}

function createMarker(compactionId: string): ChatCompactionMarker {
  return {
    anchorUserMessageId: null,
    compactionId,
    createdAt: 1,
    detailSections: [],
  }
}

test('compaction marker loads coalesce and remain available from cache', async () => {
  let callCount = 0
  const conversationId = `marker-cache-${Date.now()}-${Math.random()}`
  const marker = createMarker('compaction-1')
  const restoreWindow = installTestWindow(async () => {
    callCount += 1
    return [marker]
  })

  try {
    const [firstResult, coalescedResult] = await Promise.all([
      loadChatCompactionMarkers(conversationId),
      loadChatCompactionMarkers(conversationId),
    ])

    assert.equal(callCount, 1)
    assert.deepEqual(firstResult, [marker])
    assert.deepEqual(coalescedResult, [marker])
    assert.deepEqual(getCachedChatCompactionMarkers(conversationId), [marker])
    assert.deepEqual(await loadChatCompactionMarkers(conversationId), [marker])
    assert.equal(callCount, 1)
  } finally {
    restoreWindow()
  }
})

test('a forced marker refresh wins over an older in-flight request', async () => {
  const deferredRequests: Deferred<ChatCompactionMarker[]>[] = []
  const conversationId = `marker-refresh-${Date.now()}-${Math.random()}`
  const staleMarker = createMarker('stale-compaction')
  const freshMarkers: ChatCompactionMarker[] = []
  const restoreWindow = installTestWindow(() => {
    const deferred = createDeferred<ChatCompactionMarker[]>()
    deferredRequests.push(deferred)
    return deferred.promise
  })

  try {
    const staleRequest = loadChatCompactionMarkers(conversationId, { forceRefresh: true })
    const freshRequest = loadChatCompactionMarkers(conversationId, { forceRefresh: true })

    await Promise.resolve()
    assert.equal(deferredRequests.length, 2)
    deferredRequests[1]?.resolve(freshMarkers)
    await freshRequest

    deferredRequests[0]?.resolve([staleMarker])
    await staleRequest

    assert.deepEqual(getCachedChatCompactionMarkers(conversationId), freshMarkers)
  } finally {
    restoreWindow()
  }
})

test('edited submission immediately removes discarded dividers and stale loads cannot restore them', async () => {
  const conversationId = `marker-edit-${Date.now()}-${Math.random()}`
  const earlier = { ...createMarker('earlier'), anchorUserMessageId: 'user-1', createdAt: 2 }
  const discarded = [
    { ...createMarker('same-anchor-1'), anchorUserMessageId: 'user-2', createdAt: 4 },
    { ...createMarker('same-anchor-2'), anchorUserMessageId: 'user-2', createdAt: 5 },
    { ...createMarker('later-anchor'), anchorUserMessageId: 'user-3', createdAt: 7 },
    { ...createMarker('later-same-turn-steer'), anchorUserMessageId: 'user-1', createdAt: 4 },
  ]
  const messages: Message[] = [
    { id: 'user-1', role: 'user', content: 'Earlier request', timestamp: 1 },
    { id: 'user-2', role: 'user', content: 'Edit this request', timestamp: 3 },
    { id: 'user-3', role: 'user', content: 'Later request', timestamp: 6 },
  ]
  const stale = createDeferred<ChatCompactionMarker[]>()
  let calls = 0
  const restoreWindow = installTestWindow(() => {
    calls += 1
    if (calls === 2) return stale.promise
    return Promise.resolve([earlier, ...discarded])
  })
  try {
    await loadChatCompactionMarkers(conversationId)
    const oldLoad = loadChatCompactionMarkers(conversationId, { forceRefresh: true })
    await Promise.resolve()
    discardCachedCompactionMarkersFromMessage(conversationId, messages, 'user-2')
    assert.deepEqual(getCachedChatCompactionMarkers(conversationId), [earlier])
    stale.resolve([earlier, ...discarded])
    await oldLoad
    assert.deepEqual(getCachedChatCompactionMarkers(conversationId), [earlier])
    // A failed edited send can refresh the unchanged canonical branch normally.
    await loadChatCompactionMarkers(conversationId, { forceRefresh: true })
    assert.deepEqual(getCachedChatCompactionMarkers(conversationId), [earlier, ...discarded])
  } finally {
    restoreWindow()
  }
})
