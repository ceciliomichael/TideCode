import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCachedGitStatusSnapshot,
  getCachedGitDiffSnapshot,
  releaseGitDiffSnapshot,
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
    assert.equal(statusSnapshot.fileDiffs[0]?.addedLineCount, 0)
    assert.equal(statusSnapshot.fileDiffs[0]?.removedLineCount, 0)
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


test('mutation refreshes serialize and share one fresh read after an active read', async () => {
  const pending: Deferred<Awaited<ReturnType<GitApiTestWindow['tidecodeGit']['getDiffs']>>>[] = []
  const restore = installTestWindow(() => {
    const deferred = createDeferred<Awaited<ReturnType<GitApiTestWindow['tidecodeGit']['getDiffs']>>>()
    pending.push(deferred)
    return deferred.promise
  })
  try {
    const workspace = 'C:/serialized-mutations'
    const first = loadGitDiffSnapshot(workspace, { forceRefresh: true })
    await Promise.resolve()
    const second = loadGitDiffSnapshot(workspace, { forceRefresh: true })
    const third = loadGitDiffSnapshot(workspace, { forceRefresh: true })
    assert.equal(pending.length, 1, 'mutations must queue rather than overlap reads')
    pending[0].resolve({ hasRepository: true, fileDiffs: makeModifiedFilePayload() })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(pending.length, 2, 'the burst needs only one fresh post-mutation read')
    assert.equal(getCachedGitDiffSnapshot(workspace), null, 'stale contents must not enter the cache')
    pending[1].resolve({ hasRepository: true, fileDiffs: [] })
    for (const result of await Promise.all([first, second, third])) {
      assert.deepEqual(result.fileDiffs, [])
    }
    assert.deepEqual(getCachedGitDiffSnapshot(workspace)?.fileDiffs, [])
  } finally {
    restore()
  }
})

test('background forced refreshes reuse the active read without queueing more work', async () => {
  const deferred = createDeferred<Awaited<ReturnType<GitApiTestWindow['tidecodeGit']['getDiffs']>>>()
  let calls = 0
  const restore = installTestWindow(() => { calls += 1; return deferred.promise })
  try {
    const options = { forceRefresh: true, coalesceForcedRefresh: true, includeContent: false }
    const first = loadGitDiffSnapshot('C:/coalesced-poll', options)
    const second = loadGitDiffSnapshot('C:/coalesced-poll', options)
    await Promise.resolve()
    assert.equal(calls, 1)
    deferred.resolve({ hasRepository: true, fileDiffs: [] })
    await Promise.all([first, second])
    assert.equal(calls, 1)
  } finally {
    restore()
  }
})

test('closing a content consumer releases cache and prevents an active read refilling it', async () => {
  const deferred = createDeferred<Awaited<ReturnType<GitApiTestWindow['tidecodeGit']['getDiffs']>>>()
  const restore = installTestWindow(() => deferred.promise)
  try {
    const workspace = 'C:/closed-content'
    const pending = loadGitDiffSnapshot(workspace)
    await Promise.resolve()
    releaseGitDiffSnapshot(workspace)
    deferred.resolve({ hasRepository: true, fileDiffs: makeModifiedFilePayload() })
    await pending
    assert.equal(getCachedGitDiffSnapshot(workspace), null)
  } finally {
    restore()
  }
})

test('reopening during a released read gets a fresh snapshot without overlapping it', async () => {
  const pending: Deferred<Awaited<ReturnType<GitApiTestWindow['tidecodeGit']['getDiffs']>>>[] = []
  const restore = installTestWindow(() => {
    const deferred = createDeferred<Awaited<ReturnType<GitApiTestWindow['tidecodeGit']['getDiffs']>>>()
    pending.push(deferred)
    return deferred.promise
  })
  try {
    const workspace = 'C:/reopened-content'
    const old = loadGitDiffSnapshot(workspace)
    await Promise.resolve()
    releaseGitDiffSnapshot(workspace)
    const fresh = loadGitDiffSnapshot(workspace)
    assert.equal(pending.length, 1)
    pending[0].resolve({ hasRepository: true, fileDiffs: makeModifiedFilePayload() })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(pending.length, 2)
    pending[1].resolve({ hasRepository: true, fileDiffs: [] })
    await old
    assert.deepEqual((await fresh).fileDiffs, [])
  } finally {
    restore()
  }
})

test('oversized contents remain usable by their caller without entering the inactive cache', async () => {
  const file = makeModifiedFilePayload()[0]
  file.newContent = 'x'.repeat(9 * 1024 * 1024)
  const restore = installTestWindow(async () => ({ hasRepository: true, fileDiffs: [file] }))
  try {
    const workspace = 'C:/oversized-content'
    const result = await loadGitDiffSnapshot(workspace)
    assert.equal(result.fileDiffs[0].newContent.length, file.newContent.length)
    assert.equal(getCachedGitDiffSnapshot(workspace), null)
  } finally {
    restore()
  }
})
