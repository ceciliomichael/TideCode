import { useEffect, useState } from 'react'
import { normalizeWorkspaceRootPathForComparison } from '../lib/workspaceRootPathComparison'
import type { WorkspaceRefactorCandidate } from '../types/chat'

const REFACTOR_CANDIDATE_REFRESH_DEBOUNCE_MS = 250

interface UseWorkspaceRefactorCandidatesResult {
  candidates: WorkspaceRefactorCandidate[]
  isLoading: boolean
}

export function useWorkspaceRefactorCandidates(
  workspaceRootPath: string | null | undefined,
): UseWorkspaceRefactorCandidatesResult {
  const [candidates, setCandidates] = useState<WorkspaceRefactorCandidate[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    const normalizedWorkspaceRootPath = workspaceRootPath?.trim() ?? ''
    if (normalizedWorkspaceRootPath.length === 0) {
      setCandidates([])
      setIsLoading(false)
      return
    }

    const comparableWorkspaceRootPath = normalizeWorkspaceRootPathForComparison(normalizedWorkspaceRootPath)
    let isDisposed = false
    let isInitialLoad = true
    let isRefreshInFlight = false
    let refreshRequestedWhileInFlight = false
    let refreshTimerId: number | null = null
    let isWatcherRegistered = false

    const refreshCandidates = async () => {
      if (isDisposed) {
        return
      }
      if (isRefreshInFlight) {
        refreshRequestedWhileInFlight = true
        return
      }

      isRefreshInFlight = true
      refreshRequestedWhileInFlight = false
      if (isInitialLoad) {
        setIsLoading(true)
      }

      try {
        const nextCandidates = await window.tidecodeWorkspace.listRefactorCandidates({
          workspaceRootPath: normalizedWorkspaceRootPath,
        })
        if (!isDisposed) {
          setCandidates(nextCandidates)
          isInitialLoad = false
          setIsLoading(false)
        }
      } catch (error) {
        if (!isDisposed) {
          console.error('Failed to load workspace refactor candidates', error)
          if (isInitialLoad) {
            setCandidates([])
            isInitialLoad = false
          }
          setIsLoading(false)
        }
      } finally {
        isRefreshInFlight = false
        if (!isDisposed && refreshRequestedWhileInFlight) {
          refreshRequestedWhileInFlight = false
          void refreshCandidates()
        }
      }
    }

    const scheduleRefresh = () => {
      if (isDisposed) {
        return
      }
      if (refreshTimerId !== null) {
        window.clearTimeout(refreshTimerId)
      }
      refreshTimerId = window.setTimeout(() => {
        refreshTimerId = null
        void refreshCandidates()
      }, REFACTOR_CANDIDATE_REFRESH_DEBOUNCE_MS)
    }

    setCandidates([])
    void refreshCandidates()

    const unsubscribeWorkspaceChanges = window.tidecodeWorkspace.onExplorerChange((event) => {
      if (
        normalizeWorkspaceRootPathForComparison(event.workspaceRootPath) === comparableWorkspaceRootPath
      ) {
        scheduleRefresh()
      }
    })

    void window.tidecodeWorkspace
      .watchExplorerChanges({ workspaceRootPath: normalizedWorkspaceRootPath })
      .then(() => {
        isWatcherRegistered = true
        if (isDisposed) {
          return window.tidecodeWorkspace.unwatchExplorerChanges({
            workspaceRootPath: normalizedWorkspaceRootPath,
          })
        }
      })
      .catch((error) => {
        console.error('Failed to watch workspace changes for refactor candidates', error)
      })

    window.addEventListener('focus', scheduleRefresh)

    return () => {
      isDisposed = true
      unsubscribeWorkspaceChanges()
      window.removeEventListener('focus', scheduleRefresh)
      if (refreshTimerId !== null) {
        window.clearTimeout(refreshTimerId)
      }
      if (isWatcherRegistered) {
        void window.tidecodeWorkspace
          .unwatchExplorerChanges({ workspaceRootPath: normalizedWorkspaceRootPath })
          .catch((error) => {
            console.error('Failed to stop watching workspace changes for refactor candidates', error)
          })
      }
    }
  }, [workspaceRootPath])

  return {
    candidates,
    isLoading,
  }
}
