import { useCallback, useEffect, useRef, useState } from 'react'
import { toUserFacingErrorMessage } from '../lib/userFacingError'
import type { GitDiffLineCounts } from '../types/chat'
import type { ConversationDiffSnapshot } from '../lib/chatDiffs'
import {
  getCachedGitDiffSnapshot,
  getCachedGitStatusSnapshot,
  getEmptyGitDiffSnapshot,
  loadGitDiffSnapshot,
  releaseGitDiffSnapshot,
} from '../lib/gitDiffSnapshotCache'
import { appendNewDiffsToSnapshot } from '../lib/diffSnapshotOrdering'
import { normalizeGitWorkspacePath } from '../lib/gitBranchStateCache'
import { normalizeWorkspaceRootPathForComparison } from '../lib/workspaceRootPathComparison'
import { useGitSourceControlWatcher } from './useGitSourceControlWatcher'

interface UseGitDiffSnapshotInput {
  hasRepository: boolean
  includeContent?: boolean
  pollingEnabled?: boolean
  workspacePath: string | null | undefined
}

interface UseGitDiffSnapshotResult {
  errorMessage: string | null
  isLoading: boolean
  refresh: (options?: { coalesceForcedRefresh?: boolean; forceRefresh?: boolean; silent?: boolean }) => Promise<void>
  snapshot: ConversationDiffSnapshot
}

const GIT_DIFF_POLL_INTERVAL_MS = 2_000
const GIT_FULL_DIFF_POLL_EVERY = 5

function areLineCountsEqual(left: GitDiffLineCounts | undefined, right: GitDiffLineCounts | undefined) {
  return left?.addedLineCount === right?.addedLineCount && left?.removedLineCount === right?.removedLineCount
}

function areDiffSnapshotsEqual(left: ConversationDiffSnapshot, right: ConversationDiffSnapshot) {
  if (
    left.totalAddedLineCount !== right.totalAddedLineCount ||
    left.totalRemovedLineCount !== right.totalRemovedLineCount ||
    left.fileDiffs.length !== right.fileDiffs.length
  ) {
    return false
  }

  for (let index = 0; index < left.fileDiffs.length; index += 1) {
    const leftFileDiff = left.fileDiffs[index]
    const rightFileDiff = right.fileDiffs[index]
    if (
      leftFileDiff.hasContent !== rightFileDiff.hasContent ||
      leftFileDiff.fileName !== rightFileDiff.fileName ||
      !areLineCountsEqual(leftFileDiff.stagedLineCounts, rightFileDiff.stagedLineCounts) ||
      !areLineCountsEqual(leftFileDiff.unstagedLineCounts, rightFileDiff.unstagedLineCounts) ||
      leftFileDiff.addedLineCount !== rightFileDiff.addedLineCount ||
      leftFileDiff.contentSignature !== rightFileDiff.contentSignature ||
      leftFileDiff.indexContent !== rightFileDiff.indexContent ||
      leftFileDiff.changeStatus !== rightFileDiff.changeStatus ||
      leftFileDiff.stagedChangeStatus !== rightFileDiff.stagedChangeStatus ||
      leftFileDiff.unstagedChangeStatus !== rightFileDiff.unstagedChangeStatus ||
      leftFileDiff.originalFileName !== rightFileDiff.originalFileName ||
      leftFileDiff.isDeleted !== rightFileDiff.isDeleted ||
      leftFileDiff.removedLineCount !== rightFileDiff.removedLineCount ||
      leftFileDiff.isStaged !== rightFileDiff.isStaged ||
      leftFileDiff.isUnstaged !== rightFileDiff.isUnstaged ||
      leftFileDiff.isUntracked !== rightFileDiff.isUntracked ||
      leftFileDiff.newContent !== rightFileDiff.newContent ||
      leftFileDiff.oldContent !== rightFileDiff.oldContent
    ) {
      return false
    }
  }

  return true
}

function areGitStatusSnapshotsEqual(left: ConversationDiffSnapshot, right: ConversationDiffSnapshot) {
  if (left.fileDiffs.length !== right.fileDiffs.length) {
    return false
  }

  const rightByFileName = new Map(right.fileDiffs.map((fileDiff) => [fileDiff.fileName, fileDiff]))
  for (const leftFileDiff of left.fileDiffs) {
    const rightFileDiff = rightByFileName.get(leftFileDiff.fileName)
    if (
      !rightFileDiff ||
      !areLineCountsEqual(leftFileDiff.stagedLineCounts, rightFileDiff.stagedLineCounts) ||
      !areLineCountsEqual(leftFileDiff.unstagedLineCounts, rightFileDiff.unstagedLineCounts) ||
      leftFileDiff.addedLineCount !== rightFileDiff.addedLineCount ||
      leftFileDiff.removedLineCount !== rightFileDiff.removedLineCount ||
      leftFileDiff.isStaged !== rightFileDiff.isStaged ||
      leftFileDiff.isUnstaged !== rightFileDiff.isUnstaged ||
      leftFileDiff.isUntracked !== rightFileDiff.isUntracked ||
      leftFileDiff.changeStatus !== rightFileDiff.changeStatus ||
      leftFileDiff.stagedChangeStatus !== rightFileDiff.stagedChangeStatus ||
      leftFileDiff.unstagedChangeStatus !== rightFileDiff.unstagedChangeStatus ||
      leftFileDiff.originalFileName !== rightFileDiff.originalFileName ||
      leftFileDiff.isDeleted !== rightFileDiff.isDeleted
    ) {
      return false
    }
  }

  return true
}

export function mergeGitStatusSnapshot(
  currentSnapshot: ConversationDiffSnapshot,
  statusSnapshot: ConversationDiffSnapshot,
): ConversationDiffSnapshot {
  const currentByFileName = new Map(currentSnapshot.fileDiffs.map((fileDiff) => [fileDiff.fileName, fileDiff]))
  const fileDiffs = statusSnapshot.fileDiffs.map((statusFileDiff) => {
    const currentFileDiff = currentByFileName.get(statusFileDiff.fileName)
    if (!currentFileDiff || currentFileDiff.hasContent === false) {
      return statusFileDiff
    }

    return {
      ...currentFileDiff,
      stagedLineCounts: statusFileDiff.stagedLineCounts,
      unstagedLineCounts: statusFileDiff.unstagedLineCounts,
      isStaged: statusFileDiff.isStaged,
      isUnstaged: statusFileDiff.isUnstaged,
      isUntracked: statusFileDiff.isUntracked,
      isDeleted: statusFileDiff.isDeleted,
      changeStatus: statusFileDiff.changeStatus,
      stagedChangeStatus: statusFileDiff.stagedChangeStatus,
      unstagedChangeStatus: statusFileDiff.unstagedChangeStatus,
      originalFileName: statusFileDiff.originalFileName,
    }
  })

  return {
    fileDiffs,
    totalAddedLineCount: fileDiffs.reduce((total, fileDiff) => total + fileDiff.addedLineCount, 0),
    totalRemovedLineCount: fileDiffs.reduce((total, fileDiff) => total + fileDiff.removedLineCount, 0),
  }
}

export function useGitDiffSnapshot({
  hasRepository,
  includeContent = true,
  pollingEnabled = true,
  workspacePath,
}: UseGitDiffSnapshotInput): UseGitDiffSnapshotResult {
  const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
  useGitSourceControlWatcher(normalizedWorkspacePath)
  const [snapshot, setSnapshot] = useState<ConversationDiffSnapshot>(
    () =>
      (includeContent ? getCachedGitDiffSnapshot(normalizedWorkspacePath) : null) ??
      getCachedGitStatusSnapshot(normalizedWorkspacePath) ??
      getEmptyGitDiffSnapshot(),
  )
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const activeWorkspacePathRef = useRef(normalizedWorkspacePath)
  const activeContentModeRef = useRef(includeContent)
  activeWorkspacePathRef.current = normalizedWorkspacePath
  activeContentModeRef.current = includeContent
  const pollCycleRef = useRef(0)
  const snapshotRef = useRef(snapshot)
  const snapshotIdentityRef = useRef({
    includeContent,
    workspacePath: normalizedWorkspacePath,
  })

  useEffect(() => {
    activeWorkspacePathRef.current = normalizedWorkspacePath
  }, [normalizedWorkspacePath])

  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  const refresh = useCallback(async (options?: { coalesceForcedRefresh?: boolean; forceRefresh?: boolean; silent?: boolean }) => {
    const requestWorkspacePath = normalizeGitWorkspacePath(workspacePath)
    if (!requestWorkspacePath) {
      if (requestWorkspacePath === activeWorkspacePathRef.current) {
        setSnapshot((currentSnapshot) => {
          const emptySnapshot = getEmptyGitDiffSnapshot()
          return areDiffSnapshotsEqual(currentSnapshot, emptySnapshot) ? currentSnapshot : emptySnapshot
        })
        if (!options?.silent) {
          setIsLoading(false)
        }
        setErrorMessage(null)
      }
      return
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    if (!options?.silent) {
      setIsLoading(true)
      setErrorMessage(null)
    }

    try {
      const diffSnapshot = await loadGitDiffSnapshot(requestWorkspacePath, {
        coalesceForcedRefresh: options?.coalesceForcedRefresh,
        forceRefresh: options?.forceRefresh,
        includeContent,
      })
      if (
        requestId !== requestIdRef.current ||
        requestWorkspacePath !== activeWorkspacePathRef.current ||
        includeContent !== activeContentModeRef.current
      ) {
        return
      }

      const canPreserveExistingOrder =
        snapshotIdentityRef.current.includeContent === includeContent &&
        snapshotIdentityRef.current.workspacePath === requestWorkspacePath

      setSnapshot((currentSnapshot) => {
        const nextSnapshot = canPreserveExistingOrder
          ? appendNewDiffsToSnapshot(currentSnapshot, diffSnapshot)
          : diffSnapshot
        return areDiffSnapshotsEqual(currentSnapshot, nextSnapshot) ? currentSnapshot : nextSnapshot
      })
    } catch (error) {
      if (
        requestId !== requestIdRef.current ||
        requestWorkspacePath !== activeWorkspacePathRef.current ||
        includeContent !== activeContentModeRef.current
      ) {
        return
      }

      setErrorMessage(toUserFacingErrorMessage(error, 'The Git changes could not be loaded.'))
    } finally {
      if (
        requestId === requestIdRef.current &&
        requestWorkspacePath === activeWorkspacePathRef.current &&
        includeContent === activeContentModeRef.current
      ) {
        setIsLoading(false)
      }
    }
  }, [includeContent, workspacePath])

  const refreshStatus = useCallback(async (options?: { coalesceForcedRefresh?: boolean }) => {
    const requestWorkspacePath = normalizeGitWorkspacePath(workspacePath)
    if (!requestWorkspacePath) {
      return false
    }

    try {
      const statusSnapshot = await loadGitDiffSnapshot(requestWorkspacePath, {
        coalesceForcedRefresh: options?.coalesceForcedRefresh,
        forceRefresh: true,
        includeContent: false,
      })
      if (requestWorkspacePath !== activeWorkspacePathRef.current || includeContent !== activeContentModeRef.current) {
        return false
      }

      const currentSnapshot = snapshotRef.current
      if (areGitStatusSnapshotsEqual(currentSnapshot, statusSnapshot)) {
        return false
      }

      const nextSnapshot = includeContent
        ? mergeGitStatusSnapshot(currentSnapshot, statusSnapshot)
        : appendNewDiffsToSnapshot(currentSnapshot, statusSnapshot)
      snapshotRef.current = nextSnapshot
      setSnapshot(nextSnapshot)
      return true
    } catch {
      return false
    }
  }, [includeContent, workspacePath])

  useEffect(() => {
    requestIdRef.current += 1
    snapshotIdentityRef.current = {
      includeContent,
      workspacePath: normalizeGitWorkspacePath(workspacePath),
    }
    const cachedSnapshot =
      (includeContent ? getCachedGitDiffSnapshot(workspacePath) : null) ??
      getCachedGitStatusSnapshot(workspacePath) ??
      getEmptyGitDiffSnapshot()
    snapshotRef.current = cachedSnapshot
    setSnapshot((currentSnapshot) => (areDiffSnapshotsEqual(currentSnapshot, cachedSnapshot) ? currentSnapshot : cachedSnapshot))
    // A cold list must not wait for every file body. Warm status remains visible
    // while the independent full-content request hydrates its preview rows.
    if (includeContent && !getCachedGitStatusSnapshot(workspacePath)) {
      void refreshStatus({ coalesceForcedRefresh: true })
    }
    void refresh()
    return () => {
      requestIdRef.current += 1
      if (includeContent) {
        releaseGitDiffSnapshot(workspacePath)
      }
    }
  }, [includeContent, refresh, refreshStatus, workspacePath])

  useEffect(() => {
    if (!pollingEnabled || !hasRepository || !normalizedWorkspacePath) {
      return
    }

    const comparableWorkspacePath = normalizeWorkspaceRootPathForComparison(normalizedWorkspacePath)
    const unsubscribe = window.tidecodeGit.onSourceControlChange((event) => {
      if (normalizeWorkspaceRootPathForComparison(event.workspacePath) !== comparableWorkspacePath) {
        return
      }

      void (async () => {
        await refreshStatus()
        if (includeContent) {
          await refresh({ forceRefresh: true, silent: true })
        }
      })()
    })

    return () => {
      unsubscribe()
    }
  }, [hasRepository, includeContent, normalizedWorkspacePath, pollingEnabled, refresh, refreshStatus])

  useEffect(() => {
    if (!pollingEnabled || !hasRepository || !workspacePath) {
      return
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'hidden') {
        return
      }

      pollCycleRef.current = (pollCycleRef.current + 1) % GIT_FULL_DIFF_POLL_EVERY
      void refreshStatus({ coalesceForcedRefresh: true }).then((statusChanged) => {
        if (includeContent && (statusChanged || pollCycleRef.current === 0)) {
          void refresh({ coalesceForcedRefresh: true, forceRefresh: true, silent: true })
        }
      })
    }, GIT_DIFF_POLL_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [hasRepository, includeContent, pollingEnabled, refresh, refreshStatus, workspacePath])

  return {
    errorMessage,
    isLoading,
    refresh,
    snapshot: snapshotIdentityRef.current.workspacePath === normalizedWorkspacePath
      ? snapshot
      : getCachedGitStatusSnapshot(normalizedWorkspacePath) ?? getEmptyGitDiffSnapshot(),
  }
}

export type GitDiffSnapshotController = ReturnType<typeof useGitDiffSnapshot>
