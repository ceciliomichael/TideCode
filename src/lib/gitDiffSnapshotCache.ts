import { buildFileDiffSnapshot, type ConversationDiffSnapshot } from './chatDiffs'
import { normalizeGitWorkspacePath } from './gitBranchStateCache'

const EMPTY_DIFF_SNAPSHOT: ConversationDiffSnapshot = {
  fileDiffs: [],
  totalAddedLineCount: 0,
  totalRemovedLineCount: 0,
}
const MAX_DIFF_SNAPSHOT_CACHE_ENTRIES = 12

const diffSnapshotCache = new Map<string, ConversationDiffSnapshot>()
const statusSnapshotCache = new Map<string, ConversationDiffSnapshot>()
const inFlightDiffSnapshotRequests = new Map<string, Promise<ConversationDiffSnapshot>>()

function getSnapshotCache(includeContent: boolean) {
  return includeContent ? diffSnapshotCache : statusSnapshotCache
}

function getRequestKey(workspacePath: string, includeContent: boolean) {
  return `${includeContent ? 'content' : 'status'}:${workspacePath}`
}

function setCachedDiffSnapshot(cacheKey: string, snapshot: ConversationDiffSnapshot) {
  if (diffSnapshotCache.has(cacheKey)) {
    diffSnapshotCache.delete(cacheKey)
  }

  diffSnapshotCache.set(cacheKey, snapshot)
  while (diffSnapshotCache.size > MAX_DIFF_SNAPSHOT_CACHE_ENTRIES) {
    const oldestKey = diffSnapshotCache.keys().next().value
    if (typeof oldestKey !== 'string') {
      break
    }

    diffSnapshotCache.delete(oldestKey)
  }
}

export function getEmptyGitDiffSnapshot() {
  return EMPTY_DIFF_SNAPSHOT
}

export function getCachedGitDiffSnapshot(workspacePath: string | null | undefined) {
  const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
  if (!normalizedWorkspacePath) {
    return null
  }

  const cachedSnapshot = diffSnapshotCache.get(normalizedWorkspacePath)
  if (!cachedSnapshot) {
    return null
  }

  // Keep most recently accessed entries alive while older snapshots are evicted.
  setCachedDiffSnapshot(normalizedWorkspacePath, cachedSnapshot)
  return cachedSnapshot
}

function setCachedStatusSnapshot(cacheKey: string, snapshot: ConversationDiffSnapshot) {
  if (statusSnapshotCache.has(cacheKey)) {
    statusSnapshotCache.delete(cacheKey)
  }

  statusSnapshotCache.set(cacheKey, snapshot)
  while (statusSnapshotCache.size > MAX_DIFF_SNAPSHOT_CACHE_ENTRIES) {
    const oldestKey = statusSnapshotCache.keys().next().value
    if (typeof oldestKey !== 'string') {
      break
    }

    statusSnapshotCache.delete(oldestKey)
  }
}

export function getCachedGitStatusSnapshot(workspacePath: string | null | undefined) {
  const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
  if (!normalizedWorkspacePath) {
    return null
  }

  const cachedSnapshot = statusSnapshotCache.get(normalizedWorkspacePath)
  if (!cachedSnapshot) {
    return null
  }

  return cachedSnapshot
}

export async function loadGitDiffSnapshot(
  workspacePath: string | null | undefined,
  options?: { forceRefresh?: boolean; includeContent?: boolean },
) {
  const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
  if (!normalizedWorkspacePath) {
    return EMPTY_DIFF_SNAPSHOT
  }

  const includeContent = options?.includeContent !== false
  const snapshotCache = getSnapshotCache(includeContent)
  const requestKey = getRequestKey(normalizedWorkspacePath, includeContent)

  if (!options?.forceRefresh) {
    const cachedDiffSnapshot = snapshotCache.get(normalizedWorkspacePath)
    if (cachedDiffSnapshot) {
      return cachedDiffSnapshot
    }
  }

  // Coalesce concurrent loads only when the caller accepts cached results.
  // A forced refresh must never join an older in-flight request: that request
  // may have captured the repository state before a mutation (for example a
  // discard) finished, and reusing it would keep stale file changes on screen.
  const existingRequest = inFlightDiffSnapshotRequests.get(requestKey)
  if (existingRequest && !options?.forceRefresh) {
    return existingRequest
  }

  const nextRequest = window.tidecodeGit
    .getDiffs(normalizedWorkspacePath, { includeContent })
    .then((diffSnapshot) => {
      const normalizedSnapshot = diffSnapshot.hasRepository
        ? buildFileDiffSnapshot(diffSnapshot.fileDiffs)
        : EMPTY_DIFF_SNAPSHOT
      // Only the newest request for this key may populate the cache. A request
      // superseded by a forced refresh could otherwise overwrite fresher
      // results with the pre-mutation state.
      if (inFlightDiffSnapshotRequests.get(requestKey) === nextRequest) {
        if (includeContent) {
          setCachedDiffSnapshot(normalizedWorkspacePath, normalizedSnapshot)
        } else {
          setCachedStatusSnapshot(normalizedWorkspacePath, normalizedSnapshot)
        }
      }
      return normalizedSnapshot
    })
    .finally(() => {
      if (inFlightDiffSnapshotRequests.get(requestKey) === nextRequest) {
        inFlightDiffSnapshotRequests.delete(requestKey)
      }
    })

  inFlightDiffSnapshotRequests.set(requestKey, nextRequest)
  return nextRequest
}

export async function prefetchGitDiffSnapshots(workspacePaths: readonly (string | null | undefined)[]) {
  const uniqueWorkspacePaths = Array.from(
    new Set(workspacePaths.map((workspacePath) => normalizeGitWorkspacePath(workspacePath)).filter(Boolean)),
  )

  await Promise.allSettled(uniqueWorkspacePaths.map((workspacePath) => loadGitDiffSnapshot(workspacePath)))
}
