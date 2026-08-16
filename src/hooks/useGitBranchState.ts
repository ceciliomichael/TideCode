import { useCallback, useEffect, useRef, useState } from 'react'
import { toUserFacingErrorMessage } from '../lib/userFacingError'
import type { GitBranchState } from '../types/chat'
import {
  getCachedGitBranchState,
  getEmptyGitBranchState,
  loadGitBranchState,
  normalizeGitWorkspacePath,
  storeCachedGitBranchState,
} from '../lib/gitBranchStateCache'
import { normalizeWorkspaceRootPathForComparison } from '../lib/workspaceRootPathComparison'
import { useGitSourceControlWatcher } from './useGitSourceControlWatcher'

const EMPTY_BRANCH_STATE: GitBranchState = getEmptyGitBranchState()

interface UseGitBranchStateResult {
  branchState: GitBranchState
  changeBranch: (branchName: string) => Promise<void>
  createBranch: (branchName: string) => Promise<void>
  errorMessage: string | null
  isLoading: boolean
  refresh: (options?: { forceRefresh?: boolean; silent?: boolean }) => Promise<void>
  isSwitching: boolean
}

export function useGitBranchState(workspacePath: string | null | undefined): UseGitBranchStateResult {
  const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
  useGitSourceControlWatcher(normalizedWorkspacePath)
  const [branchState, setBranchState] = useState<GitBranchState>(
    () => getCachedGitBranchState(normalizedWorkspacePath) ?? EMPTY_BRANCH_STATE,
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSwitching, setIsSwitching] = useState(false)
  const requestIdRef = useRef(0)
  const isSwitchingRef = useRef(false)
  const activeWorkspacePathRef = useRef(normalizedWorkspacePath)

  useEffect(() => {
    activeWorkspacePathRef.current = normalizedWorkspacePath
  }, [normalizedWorkspacePath])

  const refresh = useCallback(async (options?: { forceRefresh?: boolean; silent?: boolean }) => {
    const requestWorkspacePath = normalizeGitWorkspacePath(workspacePath)
    if (!requestWorkspacePath) {
      if (requestWorkspacePath === activeWorkspacePathRef.current) {
        setBranchState(EMPTY_BRANCH_STATE)
        setErrorMessage(null)
        setIsLoading(false)
      }
      return
    }

    if (isSwitchingRef.current) {
      return
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const isSilent = options?.silent === true
    setIsLoading(!isSilent)
    setErrorMessage(null)

    try {
      const nextBranchState = await loadGitBranchState(requestWorkspacePath, {
        forceRefresh: options?.forceRefresh ?? true,
      })
      if (
        requestId !== requestIdRef.current ||
        requestWorkspacePath !== activeWorkspacePathRef.current
      ) {
        return
      }

      setBranchState(nextBranchState)
    } catch (error) {
      if (
        requestId === requestIdRef.current &&
        requestWorkspacePath === activeWorkspacePathRef.current
      ) {
        setBranchState(EMPTY_BRANCH_STATE)
        setErrorMessage(toUserFacingErrorMessage(error, 'The Git branches could not be loaded.'))
      }
    } finally {
      if (
        requestId === requestIdRef.current &&
        requestWorkspacePath === activeWorkspacePathRef.current
      ) {
        if (!isSilent) {
          setIsLoading(false)
        }
      }
    }
  }, [workspacePath])

  useEffect(() => {
    let isCancelled = false

    void (async () => {
      const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
      if (!normalizedWorkspacePath) {
        setBranchState(EMPTY_BRANCH_STATE)
        setErrorMessage(null)
        setIsLoading(false)
        return
      }

      const cachedBranchState = getCachedGitBranchState(normalizedWorkspacePath)
      setBranchState(cachedBranchState ?? EMPTY_BRANCH_STATE)
      setIsLoading(cachedBranchState === null)
      setErrorMessage(null)

      try {
        const nextBranchState = await loadGitBranchState(normalizedWorkspacePath)
        if (!isCancelled && normalizedWorkspacePath === activeWorkspacePathRef.current) {
          setBranchState(nextBranchState)
        }
      } catch (error) {
        if (!isCancelled && normalizedWorkspacePath === activeWorkspacePathRef.current) {
          setBranchState(EMPTY_BRANCH_STATE)
          setErrorMessage(toUserFacingErrorMessage(error, 'The Git branches could not be loaded.'))
        }
      } finally {
        if (!isCancelled && normalizedWorkspacePath === activeWorkspacePathRef.current) {
          setIsLoading(false)
        }
      }
    })()

    return () => {
      isCancelled = true
    }
  }, [workspacePath])


  useEffect(() => {
    if (!normalizedWorkspacePath) {
      return
    }

    const comparableWorkspacePath = normalizeWorkspaceRootPathForComparison(normalizedWorkspacePath)
    const unsubscribe = window.tidecodeGit.onSourceControlChange((event) => {
      if (normalizeWorkspaceRootPathForComparison(event.workspacePath) !== comparableWorkspacePath) {
        return
      }

      void refresh({ forceRefresh: true, silent: true })
    })

    return () => {
      unsubscribe()
    }
  }, [normalizedWorkspacePath, refresh])

  useEffect(() => {
    if (!workspacePath) {
      return
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'hidden') {
        return
      }

      void refresh({ forceRefresh: true, silent: true })
    }, 5000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [refresh, workspacePath])

  const changeBranch = useCallback(
    async (branchName: string) => {
      const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
      if (!normalizedWorkspacePath) {
        return
      }

      isSwitchingRef.current = true
      requestIdRef.current += 1
      setIsLoading(false)
      setIsSwitching(true)
      setErrorMessage(null)

      try {
        const nextBranchState = await window.tidecodeGit.checkoutBranch({
          branchName,
          workspacePath: normalizedWorkspacePath,
        })
        storeCachedGitBranchState(normalizedWorkspacePath, nextBranchState)
        if (normalizedWorkspacePath === activeWorkspacePathRef.current) {
          setBranchState(nextBranchState)
        }
      } catch (error) {
        const message = toUserFacingErrorMessage(error, 'The branch could not be switched.')
        setErrorMessage(message)
        throw error instanceof Error ? error : new Error(message)
      } finally {
        isSwitchingRef.current = false
        setIsSwitching(false)
      }
    },
    [workspacePath],
  )

  const createBranch = useCallback(
    async (branchName: string) => {
      const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
      if (!normalizedWorkspacePath) {
        return
      }

      isSwitchingRef.current = true
      requestIdRef.current += 1
      setIsLoading(false)
      setIsSwitching(true)
      setErrorMessage(null)

      try {
        const nextBranchState = await window.tidecodeGit.createAndCheckoutBranch({
          branchName,
          workspacePath: normalizedWorkspacePath,
        })
        storeCachedGitBranchState(normalizedWorkspacePath, nextBranchState)
        if (normalizedWorkspacePath === activeWorkspacePathRef.current) {
          setBranchState(nextBranchState)
        }
      } catch (error) {
        const message = toUserFacingErrorMessage(error, 'The branch could not be created.')
        setErrorMessage(message)
        throw error instanceof Error ? error : new Error(message)
      } finally {
        isSwitchingRef.current = false
        setIsSwitching(false)
      }
    },
    [workspacePath],
  )

  return {
    branchState,
    changeBranch,
    createBranch,
    errorMessage,
    isLoading,
    refresh,
    isSwitching,
  }
}

export type GitBranchStateController = ReturnType<typeof useGitBranchState>
