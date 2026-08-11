import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCachedGitStatusSnapshot,
  loadGitDiffSnapshot,
} from '../../src/lib/gitDiffSnapshotCache'

interface GitFileDiffPayload {
  fileName: string
  isStaged: boolean
  isUnstaged: boolean
  isUntracked: boolean
  newContent: string
  oldContent: string | null
}

interface GitApiTestWindow {
  tidecodeGit: {
    getDiffs: (workspacePath: string, options?: { includeContent?: boolean }) => Promise<{
      fileDiffs: GitFileDiffPayload[]
      hasRepository: boolean
    }>
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
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

function installTestWindow(getDiffs: GitApiTestWindow['tidecodeGit']['getDiffs']) {
  const originalWindow = (globalThis as { window?: GitApiTestWindow }).window
  const testWindow: GitApiTestWindow = { tidecodeGit: { getDiffs } }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: testWindow })
  return () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  }
}

function makeModifiedFilePayload(options?: { includeContent?: boolean }): GitFileDiffPayload[] {
  return [
    {
      fileName: 'src/example.ts',
      isStaged: false,
      isUnstaged: true,
      isUntracked: false,
      newContent: options?.includeContent === false ? '' : 'const value = 1\n',
      oldContent: options?.includeContent === false ? null : 'const value = 0\n',
    },
  ]
}

test('loads status-only git metadata without reading diff content and coalesces non-forced refreshes', async () => {
  const calls: Array<{ includeContent?: boolean; workspacePath: string }> = []
  const restoreWindow = installTestWindow(async (workspacePath, options) => {
    calls.push({ includeContent: options?.includeContent, workspacePath })
    return {
      fileDiffs: makeModifiedFilePayload(options),
      hasRepository: true,
    }
  })

  try {
    const workspacePath = `C:/cache-test-${Date.now()}-${Math.random()}`
    const [statusSnapshot, coalescedStatusSnapshot] = await Promise.all([
      loadGitDiffSnapshot(workspacePath, { includeContent: false }),
      loadGitDiffSnapshot(workspacePath, { includeContent: false }),
    ])

    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], { includeContent: false, workspacePath })
    assert.equal(statusSnapshot.fileDiffs[0]?.newContent, '')
    assert.equal(coalescedStatusSnapshot.fileDiffs[0]?.oldContent, null)
    assert.equal(getCachedGitStatusSnapshot(workspacePath)?.fileDiffs[0]?.isUnstaged, true)

    const detailedSnapshot = await loadGitDiffSnapshot(workspacePath, {
      forceRefresh: true,
      includeContent: true,
    })
    assert.equal(calls.length, 2)
    assert.equal(calls[1]?.includeContent, true)
    assert.equal(detailedSnapshot.fileDiffs[0]?.newContent, 'const value = 1\n')
    assert.equal(detailedSnapshot.totalAddedLineCount, 1)
    assert.equal(detailedSnapshot.totalRemovedLineCount, 1)
  } finally {
    restoreWindow()
  }
})

test('a forced refresh starts a fresh request instead of joining an in-flight one', async () => {
  const deferredRequests: Deferred<ReturnType<GitApiTestWindow['tidecodeGit']['getDiffs']>>[] = []
  const restoreWindow = installTestWindow(() => {
    const deferred = createDeferred<ReturnType<GitApiTestWindow['tidecodeGit']['getDiffs']>>()
    deferredRequests.push(deferred)
    return deferred.promise
  })

  try {
    const workspacePath = `C:/force-refresh-test-${Date.now()}-${Math.random()}`

    // The poll starts a slow request that captured the pre-discard state.
    const staleRequestPromise = loadGitDiffSnapshot(workspacePath, {
      forceRefresh: true,
      includeContent: false,
    })
    assert.equal(deferredRequests.length, 1)

    // A discard's forced refresh must not join the stale in-flight request.
    const freshRequestPromise = loadGitDiffSnapshot(workspacePath, {
      forceRefresh: true,
      includeContent: false,
    })
    assert.equal(deferredRequests.length, 2)

    // The stale request resolves after the fresh one with the old state; it
    // must neither win the UI race nor pollute the cache.
    deferredRequests[1]?.resolve({
      fileDiffs: [],
      hasRepository: true,
    })
    const freshSnapshot = await freshRequestPromise
    assert.deepEqual(freshSnapshot.fileDiffs, [])

    deferredRequests[0]?.resolve({
      fileDiffs: makeModifiedFilePayload({ includeContent: false }),
      hasRepository: true,
    })
    await staleRequestPromise

    assert.equal(getCachedGitStatusSnapshot(workspacePath)?.fileDiffs.length ?? 0, 0)

    // A later non-forced load is served from the cache populated by the
    // freshest request, not the superseded stale one.
    const cachedSnapshot = await loadGitDiffSnapshot(workspacePath, { includeContent: false })
    assert.deepEqual(cachedSnapshot.fileDiffs, [])
  } finally {
    restoreWindow()
  }
})

test('a stale superseded request does not overwrite the cache after a forced refresh completes', async () => {
  const deferredRequests: Deferred<ReturnType<GitApiTestWindow['tidecodeGit']['getDiffs']>>[] = []
  const restoreWindow = installTestWindow(() => {
    const deferred = createDeferred<ReturnType<GitApiTestWindow['tidecodeGit']['getDiffs']>>()
    deferredRequests.push(deferred)
    return deferred.promise
  })

  try {
    const workspacePath = `C:/stale-cache-test-${Date.now()}-${Math.random()}`

    const staleRequestPromise = loadGitDiffSnapshot(workspacePath, {
      forceRefresh: true,
      includeContent: false,
    })
    const freshRequestPromise = loadGitDiffSnapshot(workspacePath, {
      forceRefresh: true,
      includeContent: false,
    })

    // Fresh request resolves first and populates the cache.
    deferredRequests[1]?.resolve({
      fileDiffs: [],
      hasRepository: true,
    })
    await freshRequestPromise
    assert.equal(getCachedGitStatusSnapshot(workspacePath)?.fileDiffs.length ?? 0, 0)

    // The stale request completes afterwards; the cache must stay fresh.
    deferredRequests[0]?.resolve({
      fileDiffs: makeModifiedFilePayload({ includeContent: false }),
      hasRepository: true,
    })
    await staleRequestPromise

    const cachedSnapshot = await loadGitDiffSnapshot(workspacePath, { includeContent: false })
    assert.deepEqual(cachedSnapshot.fileDiffs, [])
  } finally {
    restoreWindow()
  }
})
