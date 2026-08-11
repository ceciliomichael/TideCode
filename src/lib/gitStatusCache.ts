import type { GitStatusResult } from '../types/chat'
import { normalizeGitWorkspacePath } from './gitBranchStateCache'

const EMPTY_GIT_STATUS: GitStatusResult = {
  addedLineCount: 0,
  changedFileCount: 0,
  hasRepository: false,
  removedLineCount: 0,
  stagedFileCount: 0,
  unstagedFileCount: 0,
  untrackedFileCount: 0,
}
const MAX_GIT_STATUS_CACHE_ENTRIES = 24

const gitStatusCache = new Map<string, GitStatusResult>()
const inFlightGitStatusRequests = new Map<string, Promise<GitStatusResult>>()

function setCachedGitStatus(cacheKey: string, status: GitStatusResult) {
  if (gitStatusCache.has(cacheKey)) {
    gitStatusCache.delete(cacheKey)
  }

  gitStatusCache.set(cacheKey, status)
  while (gitStatusCache.size > MAX_GIT_STATUS_CACHE_ENTRIES) {
    const oldestKey = gitStatusCache.keys().next().value
    if (typeof oldestKey !== 'string') {
      break
    }

    gitStatusCache.delete(oldestKey)
  }
}

export function getCachedGitStatus(workspacePath: string | null | undefined) {
  const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
  if (!normalizedWorkspacePath) {
    return null
  }

  return gitStatusCache.get(normalizedWorkspacePath) ?? null
}

export async function loadGitStatus(
  workspacePath: string | null | undefined,
  options?: { forceRefresh?: boolean },
) {
  const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
  if (!normalizedWorkspacePath) {
    return EMPTY_GIT_STATUS
  }

  if (!options?.forceRefresh) {
    const cachedStatus = gitStatusCache.get(normalizedWorkspacePath)
    if (cachedStatus) {
      return cachedStatus
    }
  }

  const existingRequest = inFlightGitStatusRequests.get(normalizedWorkspacePath)
  if (existingRequest && !options?.forceRefresh) {
    return existingRequest
  }

  const nextRequest = window.tidecodeGit
    .getStatus(normalizedWorkspacePath)
    .then((status) => {
      if (inFlightGitStatusRequests.get(normalizedWorkspacePath) === nextRequest) {
        setCachedGitStatus(normalizedWorkspacePath, status)
      }

      return status
    })
    .finally(() => {
      if (inFlightGitStatusRequests.get(normalizedWorkspacePath) === nextRequest) {
        inFlightGitStatusRequests.delete(normalizedWorkspacePath)
      }
    })

  inFlightGitStatusRequests.set(normalizedWorkspacePath, nextRequest)
  return nextRequest
}

export async function prefetchGitStatuses(workspacePaths: readonly (string | null | undefined)[]) {
  const uniqueWorkspacePaths = Array.from(
    new Set(workspacePaths.map((workspacePath) => normalizeGitWorkspacePath(workspacePath)).filter(Boolean)),
  )

  await Promise.allSettled(uniqueWorkspacePaths.map((workspacePath) => loadGitStatus(workspacePath)))
}
