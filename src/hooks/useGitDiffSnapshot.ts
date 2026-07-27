import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConversationDiffSnapshot } from '../lib/chatDiffs'
import {
  getCachedGitDiffSnapshot,
  getEmptyGitDiffSnapshot,
  loadGitDiffSnapshot,
} from '../lib/gitDiffSnapshotCache'
import { normalizeGitWorkspacePath } from '../lib/gitBranchStateCache'

interface UseGitDiffSnapshotInput {
  hasRepository: boolean
  pollingEnabled?: boolean
  workspacePath: string | null | undefined
}

interface UseGitDiffSnapshotResult {
  errorMessage: string | null
  isLoading: boolean
  refresh: (options?: { forceRefresh?: boolean; silent?: boolean }) => Promise<void>
  snapshot: ConversationDiffSnapshot
}

const GIT_DIFF_POLL_INTERVAL_MS = 5000

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
      leftFileDiff.fileName !== rightFileDiff.fileName ||
      leftFileDiff.addedLineCount !== rightFileDiff.addedLineCount ||
      leftFileDiff.contentSignature !== rightFileDiff.contentSignature ||
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

export function useGitDiffSnapshot({
  hasRepository,
  pollingEnabled = true,
  workspacePath,
}: UseGitDiffSnapshotInput): UseGitDiffSnapshotResult {
  const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
  const [snapshot, setSnapshot] = useState<ConversationDiffSnapshot>(
    () => getCachedGitDiffSnapshot(normalizedWorkspacePath) ?? getEmptyGitDiffSnapshot(),
  )
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const activeWorkspacePathRef = useRef(normalizedWorkspacePath)

  useEffect(() => {
    activeWorkspacePathRef.current = normalizedWorkspacePath
  }, [normalizedWorkspacePath])

  const refresh = useCallback(async (options?: { forceRefresh?: boolean; silent?: boolean }) => {
    const requestWorkspacePath = normalizeGitWorkspacePath(workspacePath)
    if (!requestWorkspacePath || !hasRepository) {
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
        forceRefresh: options?.forceRefresh,
      })
      if (
        requestId !== requestIdRef.current ||
        requestWorkspacePath !== activeWorkspacePathRef.current
      ) {
        return
      }

      setSnapshot((currentSnapshot) => (areDiffSnapshotsEqual(currentSnapshot, diffSnapshot) ? currentSnapshot : diffSnapshot))
    } catch (error) {
      if (
        requestId !== requestIdRef.current ||
        requestWorkspacePath !== activeWorkspacePathRef.current
      ) {
        return
      }

      setSnapshot((currentSnapshot) => {
        const emptySnapshot = getEmptyGitDiffSnapshot()
        return areDiffSnapshotsEqual(currentSnapshot, emptySnapshot) ? currentSnapshot : emptySnapshot
      })
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load git diffs.')
    } finally {
      if (
        requestId === requestIdRef.current &&
        requestWorkspacePath === activeWorkspacePathRef.current &&
        !options?.silent
      ) {
        setIsLoading(false)
      }
    }
  }, [hasRepository, workspacePath])

  useEffect(() => {
    const cachedSnapshot = getCachedGitDiffSnapshot(workspacePath) ?? getEmptyGitDiffSnapshot()
    setSnapshot((currentSnapshot) => (areDiffSnapshotsEqual(currentSnapshot, cachedSnapshot) ? currentSnapshot : cachedSnapshot))
    void refresh()
  }, [refresh, workspacePath])

  useEffect(() => {
    if (!pollingEnabled || !hasRepository || !workspacePath) {
      return
    }

    void refresh({ forceRefresh: true, silent: true })
  }, [hasRepository, pollingEnabled, refresh, workspacePath])

  useEffect(() => {
    if (!pollingEnabled || !hasRepository || !workspacePath) {
      return
    }

    void window.echosphereWorkspace.watchExplorerChanges({ workspaceRootPath: workspacePath })
    const unsubscribe = window.echosphereWorkspace.onExplorerChange(() => {
      void refresh({ forceRefresh: true, silent: true })
    })

    return () => {
      unsubscribe()
      void window.echosphereWorkspace.unwatchExplorerChanges({ workspaceRootPath: workspacePath })
    }
  }, [hasRepository, pollingEnabled, refresh, workspacePath])

  useEffect(() => {
    if (!pollingEnabled || !hasRepository || !workspacePath) {
      return
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'hidden') {
        return
      }

      void refresh({ forceRefresh: true, silent: true })
    }, GIT_DIFF_POLL_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [hasRepository, pollingEnabled, refresh, workspacePath])

  return {
    errorMessage,
    isLoading,
    refresh,
    snapshot,
  }
}

export type GitDiffSnapshotController = ReturnType<typeof useGitDiffSnapshot>
