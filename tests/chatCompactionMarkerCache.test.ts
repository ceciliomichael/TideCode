import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCachedChatCompactionMarkers,
  loadChatCompactionMarkers,
} from '../src/lib/chatCompactionMarkerCache'
import type { ChatCompactionMarker } from '../src/types/chat'

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
