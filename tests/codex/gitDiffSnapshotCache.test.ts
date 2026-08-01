import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCachedGitStatusSnapshot,
  loadGitDiffSnapshot,
} from '../../src/lib/gitDiffSnapshotCache'

interface GitApiTestWindow {
  tidecodeGit: {
    getDiffs: (workspacePath: string, options?: { includeContent?: boolean }) => Promise<{
      fileDiffs: Array<{
        fileName: string
        isStaged: boolean
        isUnstaged: boolean
        isUntracked: boolean
        newContent: string
        oldContent: string | null
      }>
      hasRepository: boolean
    }>
  }
}

test('loads status-only git metadata without reading diff content and coalesces refreshes', async () => {
  const calls: Array<{ includeContent?: boolean; workspacePath: string }> = []
  const originalWindow = (globalThis as { window?: GitApiTestWindow }).window
  const testWindow: GitApiTestWindow = {
    tidecodeGit: {
      getDiffs: async (workspacePath, options) => {
        calls.push({ includeContent: options?.includeContent, workspacePath })
        return {
          fileDiffs: [
            {
              fileName: 'src/example.ts',
              isStaged: false,
              isUnstaged: true,
              isUntracked: false,
              newContent: options?.includeContent === false ? '' : 'const value = 1\n',
              oldContent: options?.includeContent === false ? null : 'const value = 0\n',
            },
          ],
          hasRepository: true,
        }
      },
    },
  }

  Object.defineProperty(globalThis, 'window', { configurable: true, value: testWindow })
  try {
    const workspacePath = `C:/cache-test-${Date.now()}-${Math.random()}`
    const [statusSnapshot, coalescedStatusSnapshot] = await Promise.all([
      loadGitDiffSnapshot(workspacePath, { forceRefresh: true, includeContent: false }),
      loadGitDiffSnapshot(workspacePath, { forceRefresh: true, includeContent: false }),
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
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  }
})
