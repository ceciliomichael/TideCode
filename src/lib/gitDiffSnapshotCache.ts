import { buildFileDiffSnapshot, type ConversationDiffSnapshot } from './chatDiffs'
import { normalizeGitWorkspacePath } from './gitBranchStateCache'

const EMPTY_DIFF_SNAPSHOT: ConversationDiffSnapshot = {
  fileDiffs: [],
  totalAddedLineCount: 0,
  totalRemovedLineCount: 0,
}
const MAX_FULL_DIFF_SNAPSHOT_CACHE_ENTRIES = 3
const MAX_STATUS_SNAPSHOT_CACHE_ENTRIES = 12

const diffSnapshotCache = new Map<string, ConversationDiffSnapshot>()
const statusSnapshotCache = new Map<string, ConversationDiffSnapshot>()
interface SnapshotRequest {
  promise: Promise<ConversationDiffSnapshot>
  pending: boolean
  revision: number
  cacheRevision: number | null
}
const inFlightDiffSnapshotRequests = new Map<string, SnapshotRequest>()
const MAX_FULL_DIFF_CACHE_BYTES = 16 * 1024 * 1024

function estimateSnapshotBytes(snapshot: ConversationDiffSnapshot) {
  return snapshot.fileDiffs.reduce((bytes, file) => bytes + 2 * (
    (file.oldContent?.length ?? 0) + (file.indexContent?.length ?? 0) + file.newContent.length
  ), 0)
}

function setCachedDiffSnapshot(cacheKey: string, snapshot: ConversationDiffSnapshot) {
  diffSnapshotCache.delete(cacheKey)
  if (estimateSnapshotBytes(snapshot) > MAX_FULL_DIFF_CACHE_BYTES) {
    return
  }
  diffSnapshotCache.set(cacheKey, snapshot)
  let totalBytes = Array.from(diffSnapshotCache.values()).reduce((sum, entry) => sum + estimateSnapshotBytes(entry), 0)
  while (diffSnapshotCache.size > MAX_FULL_DIFF_SNAPSHOT_CACHE_ENTRIES || totalBytes > MAX_FULL_DIFF_CACHE_BYTES) {
    const oldestKey = diffSnapshotCache.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    totalBytes -= estimateSnapshotBytes(diffSnapshotCache.get(oldestKey)!)
    diffSnapshotCache.delete(oldestKey)
  }
}

export function getEmptyGitDiffSnapshot() {
  return EMPTY_DIFF_SNAPSHOT
}

export function getCachedGitDiffSnapshot(workspacePath: string | null | undefined) {
  const normalized = normalizeGitWorkspacePath(workspacePath)
  if (!normalized) {
    return null
  }
  const snapshot = diffSnapshotCache.get(normalized)
  if (!snapshot) {
    return null
  }
  diffSnapshotCache.delete(normalized)
  diffSnapshotCache.set(normalized, snapshot)
  return snapshot
}

export function releaseGitDiffSnapshot(workspacePath: string | null | undefined) {
  const normalized = normalizeGitWorkspacePath(workspacePath)
  if (!normalized) {
    return
  }
  diffSnapshotCache.delete(normalized)
  const request = inFlightDiffSnapshotRequests.get(`content:${normalized}`)
  if (request) {
    request.revision += 1
    request.cacheRevision = null
    request.pending = false
  }
}

function setCachedStatusSnapshot(cacheKey: string, snapshot: ConversationDiffSnapshot) {
  statusSnapshotCache.delete(cacheKey)
  statusSnapshotCache.set(cacheKey, snapshot)
  while (statusSnapshotCache.size > MAX_STATUS_SNAPSHOT_CACHE_ENTRIES) {
    const oldestKey = statusSnapshotCache.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    statusSnapshotCache.delete(oldestKey)
  }
}

export function getCachedGitStatusSnapshot(workspacePath: string | null | undefined) {
  const normalized = normalizeGitWorkspacePath(workspacePath)
  return normalized ? statusSnapshotCache.get(normalized) ?? null : null
}

export async function loadGitDiffSnapshot(
  workspacePath: string | null | undefined,
  options?: { coalesceForcedRefresh?: boolean; forceRefresh?: boolean; includeContent?: boolean },
): Promise<ConversationDiffSnapshot> {
  const normalized = normalizeGitWorkspacePath(workspacePath)
  if (!normalized) {
    return EMPTY_DIFF_SNAPSHOT
  }
  const includeContent = options?.includeContent !== false
  const requestKey = `${includeContent ? 'content' : 'status'}:${normalized}`
  const existing = inFlightDiffSnapshotRequests.get(requestKey)
  if (existing) {
    if ((options?.forceRefresh && !options.coalesceForcedRefresh) || existing.cacheRevision === null) {
      existing.pending = true
      existing.revision += 1
      existing.cacheRevision = existing.revision
    }
    return existing.promise
  }
  const cached = includeContent ? getCachedGitDiffSnapshot(normalized) : getCachedGitStatusSnapshot(normalized)
  if (!options?.forceRefresh && cached) {
    return cached
  }

  const request: SnapshotRequest = { pending: false, revision: 0, cacheRevision: 0, promise: Promise.resolve(EMPTY_DIFF_SNAPSHOT) }
  // Defer the read one microtask so the registry owns the request before any
  // completion or reentrant refresh can inspect it.
  request.promise = Promise.resolve().then(async () => {
    let result = EMPTY_DIFF_SNAPSHOT
    do {
      request.pending = false
      const revision = request.revision
      let payload
      try {
        payload = await window.tidecodeGit.getDiffs(normalized, { includeContent })
      } catch (error) {
        if (request.pending) {
          continue
        }
        throw error
      }
      if (request.cacheRevision !== revision || request.revision !== revision) {
        continue
      }
      result = payload.hasRepository ? buildFileDiffSnapshot(payload.fileDiffs, includeContent) : EMPTY_DIFF_SNAPSHOT
      if (includeContent) {
        setCachedDiffSnapshot(normalized, result)
      } else {
        setCachedStatusSnapshot(normalized, result)
      }
    } while (request.pending)
    return result
  }).finally(() => {
    if (inFlightDiffSnapshotRequests.get(requestKey) === request) {
      inFlightDiffSnapshotRequests.delete(requestKey)
    }
  })
  inFlightDiffSnapshotRequests.set(requestKey, request)
  return request.promise
}
