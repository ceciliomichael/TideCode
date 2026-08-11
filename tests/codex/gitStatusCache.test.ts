import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCachedGitStatus,
  loadGitStatus,
  prefetchGitStatuses,
} from '../../src/lib/gitStatusCache'

interface GitStatusTestWindow {
  tidecodeGit: {
    getStatus: (workspacePath: string) => Promise<{
      addedLineCount: number
      changedFileCount: number
      hasRepository: boolean
      removedLineCount: number
      stagedFileCount: number
      unstagedFileCount: number
      untrackedFileCount: number
    }>
  }
}

function installTestWindow(getStatus: GitStatusTestWindow['tidecodeGit']['getStatus']) {
  const originalWindow = (globalThis as { window?: GitStatusTestWindow }).window
  const testWindow: GitStatusTestWindow = { tidecodeGit: { getStatus } }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: testWindow })
  return () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  }
}

test('prefetchGitStatuses warms the cache before a workspace is selected', async () => {
  const calls: string[] = []
  const restoreWindow = installTestWindow(async (workspacePath) => {
    calls.push(workspacePath)
    return {
      addedLineCount: 4,
      changedFileCount: 2,
      hasRepository: true,
      removedLineCount: 3,
      stagedFileCount: 1,
      unstagedFileCount: 1,
      untrackedFileCount: 0,
    }
  })

  try {
    const workspacePath = `C:/status-cache-test-${Date.now()}-${Math.random()}`
    await prefetchGitStatuses([workspacePath, workspacePath])

    assert.deepEqual(calls, [workspacePath])
    assert.equal(getCachedGitStatus(workspacePath)?.addedLineCount, 4)

    const cachedStatus = await loadGitStatus(workspacePath)
    assert.equal(cachedStatus.removedLineCount, 3)
    assert.equal(calls.length, 1)
  } finally {
    restoreWindow()
  }
})

test('forced Git status refresh replaces a prefetched status', async () => {
  let addedLineCount = 1
  const restoreWindow = installTestWindow(async () => ({
    addedLineCount,
    changedFileCount: 1,
    hasRepository: true,
    removedLineCount: 0,
    stagedFileCount: 0,
    unstagedFileCount: 1,
    untrackedFileCount: 0,
  }))

  try {
    const workspacePath = `C:/status-force-refresh-${Date.now()}-${Math.random()}`
    await loadGitStatus(workspacePath)
    addedLineCount = 9

    const refreshedStatus = await loadGitStatus(workspacePath, { forceRefresh: true })
    assert.equal(refreshedStatus.addedLineCount, 9)
    assert.equal(getCachedGitStatus(workspacePath)?.addedLineCount, 9)
  } finally {
    restoreWindow()
  }
})
