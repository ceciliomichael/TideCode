import assert from 'node:assert/strict'
import test from 'node:test'
import type { GitBranchState } from '../src/types/chat'
import { loadGitBranchState, getCachedGitBranchState, storeCachedGitBranchState } from '../src/lib/gitBranchStateCache'

function createBranchState(currentBranch: string): GitBranchState {
  return {
    aheadCommitCount: 0,
    behindCommitCount: 0,
    branches: [currentBranch],
    currentBranch,
    defaultBranch: 'main',
    hasRepository: true,
    hasUpstream: true,
    isDetachedHead: false,
    remoteUrl: 'https://example.com/repo.git',
    repoRootPath: 'C:/workspace',
  }
}

test('branch cache bounds project paths and repository aliases while preserving recent entries', () => {
  const state = createBranchState('main')
  for (let index = 0; index < 12; index += 1) {
    storeCachedGitBranchState(`workspace-${index}`, { ...state, repoRootPath: `root-${index}` })
  }
  assert.ok(getCachedGitBranchState('workspace-0'))
  storeCachedGitBranchState('workspace-new', { ...state, repoRootPath: 'root-new' })
  assert.ok(getCachedGitBranchState('workspace-0'))
  assert.equal(getCachedGitBranchState('root-0'), null)
  assert.equal(getCachedGitBranchState('workspace-1'), null)
  assert.ok(getCachedGitBranchState('root-new'))
})

test('forced branch refreshes coalesce while one repository read is already running', async () => {
  const originalWindow = globalThis.window
  const workspacePath = 'C:/workspace/coalesce-forced-branch-refreshes'
  let requestCount = 0
  let resolveRequest: ((state: GitBranchState) => void) | null = null

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      tidecodeGit: {
        getBranches: async () => {
          requestCount += 1
          return new Promise<GitBranchState>((resolve) => {
            resolveRequest = resolve
          })
        },
      },
    },
  })

  try {
    const firstLoad = loadGitBranchState(workspacePath, { forceRefresh: true })
    const secondLoad = loadGitBranchState(workspacePath, { forceRefresh: true })

    assert.equal(requestCount, 1)
    assert.ok(resolveRequest)
    resolveRequest(createBranchState('feature/fast-switch'))

    const [firstState, secondState] = await Promise.all([firstLoad, secondLoad])
    assert.equal(firstState.currentBranch, 'feature/fast-switch')
    assert.equal(secondState.currentBranch, 'feature/fast-switch')

    const nextState = createBranchState('main')
    const nextLoad = loadGitBranchState(workspacePath, { forceRefresh: true })
    assert.equal(requestCount, 2)
    assert.ok(resolveRequest)
    resolveRequest(nextState)
    assert.equal((await nextLoad).currentBranch, 'main')
  } finally {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window')
    } else {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
    }
  }
})
