import type { GitBranchState } from '../types/chat'

const EMPTY_BRANCH_STATE: GitBranchState = {
  aheadCommitCount: 0,
  behindCommitCount: 0,
  branches: [],
  currentBranch: null,
  remoteBranches: [],
  defaultBranch: null,
  hasRepository: false,
  hasUpstream: false,
  isDetachedHead: false,
  remoteUrl: null,
  repoRootPath: null,
}


const branchStateCache = new Map<string, GitBranchState>()
const MAX_BRANCH_CACHE_ENTRIES = 24
const inFlightBranchStateRequests = new Map<string, Promise<GitBranchState>>()

export function getEmptyGitBranchState(): GitBranchState {
  return EMPTY_BRANCH_STATE
}

export function normalizeGitWorkspacePath(workspacePath: string | null | undefined) {
  const normalizedWorkspacePath = workspacePath?.trim() ?? ''
  return normalizedWorkspacePath.length > 0 ? normalizedWorkspacePath : null
}

function cacheBranchState(cacheKey: string, branchState: GitBranchState) {
  branchStateCache.delete(cacheKey)
  branchStateCache.set(cacheKey, branchState)

  const repoRootPath = normalizeGitWorkspacePath(branchState.repoRootPath)
  if (repoRootPath) {
    branchStateCache.delete(repoRootPath)
    branchStateCache.set(repoRootPath, branchState)
  }
  while (branchStateCache.size > MAX_BRANCH_CACHE_ENTRIES) {
    const oldestKey = branchStateCache.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    branchStateCache.delete(oldestKey)
  }
}

export function getCachedGitBranchState(workspacePath: string | null | undefined) {
  const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
  if (!normalizedWorkspacePath) {
    return null
  }

  const cached = branchStateCache.get(normalizedWorkspacePath)
  if (cached) {
    branchStateCache.delete(normalizedWorkspacePath)
    branchStateCache.set(normalizedWorkspacePath, cached)
  }
  return cached ?? null
}

export function storeCachedGitBranchState(
  workspacePath: string | null | undefined,
  branchState: GitBranchState,
) {
  const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
  if (!normalizedWorkspacePath) {
    return
  }

  cacheBranchState(normalizedWorkspacePath, branchState)
}

export async function loadGitBranchState(
  workspacePath: string | null | undefined,
  options?: { forceRefresh?: boolean },
) {
  const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
  if (!normalizedWorkspacePath) {
    return EMPTY_BRANCH_STATE
  }

  if (!options?.forceRefresh) {
    const cachedBranchState = getCachedGitBranchState(normalizedWorkspacePath)
    if (cachedBranchState) {
      return cachedBranchState
    }
  }

  // forceRefresh bypasses cached data, not an already-running repository read.
  // Reusing the active read prevents watcher/poll bursts from spawning a growing
  // queue of Git subprocesses that can contend with branch checkout.
  const existingRequest = inFlightBranchStateRequests.get(normalizedWorkspacePath)
  if (existingRequest) {
    return existingRequest
  }

  const nextRequest = window.tidecodeGit
    .getBranches(normalizedWorkspacePath)
    .then((branchState) => {
      cacheBranchState(normalizedWorkspacePath, branchState)
      return branchState
    })
    .finally(() => {
      if (inFlightBranchStateRequests.get(normalizedWorkspacePath) === nextRequest) {
        inFlightBranchStateRequests.delete(normalizedWorkspacePath)
      }
    })

  inFlightBranchStateRequests.set(normalizedWorkspacePath, nextRequest)
  return nextRequest
}

export async function prefetchGitBranchStates(workspacePaths: readonly (string | null | undefined)[]) {
  const uniqueWorkspacePaths = Array.from(
    new Set(workspacePaths.map((workspacePath) => normalizeGitWorkspacePath(workspacePath)).filter(Boolean)),
  )

  await Promise.allSettled(
    uniqueWorkspacePaths.map((workspacePath) => loadGitBranchState(workspacePath)),
  )
}
