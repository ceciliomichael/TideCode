import { useCallback, useEffect, useRef, useState } from 'react'
import { toUserFacingErrorMessage } from '../lib/userFacingError'
import type { ChatProviderId, GitCommitAction, GitCommitModelSelection, GitCommitResult, GitStatusResult, ReasoningEffort } from '../types/chat'
import { normalizeGitWorkspacePath } from '../lib/gitBranchStateCache'
import { getCachedGitStatus, loadGitStatus } from '../lib/gitStatusCache'
import {
  beginSourceControlCommitOperation,
  endSourceControlCommitOperation,
} from '../lib/sourceControlPendingStateStore'
import { normalizeWorkspaceRootPathForComparison } from '../lib/workspaceRootPathComparison'
import { useGitSourceControlWatcher } from './useGitSourceControlWatcher'

interface UseGitCommitInput {
  modelId: string
  providerId: ChatProviderId | null
  reasoningEffort: ReasoningEffort
  workspacePath: string | null | undefined
}

interface UseGitCommitResult {
  commit: (input: {
    action: GitCommitAction
    includeUnstaged?: boolean
    message: string
    preferredBranchName?: string
  }) => Promise<GitCommitResult | null>
  errorMessage: string | null
  isCommitting: boolean
  isLoadingStatus: boolean
  lastCommitResult: GitCommitResult | null
  modelSelection: GitCommitModelSelection
  refreshStatus: (options?: { forceRefresh?: boolean }) => Promise<void>
  resetResult: () => void
  status: GitStatusResult | null
}

const EMPTY_STATUS: GitStatusResult = {
  addedLineCount: 0,
  changedFileCount: 0,
  hasRepository: false,
  removedLineCount: 0,
  stagedFileCount: 0,
  unstagedFileCount: 0,
  untrackedFileCount: 0,
}
const GIT_STATUS_POLL_INTERVAL_MS = 10000

export function useGitCommit({
  modelId,
  providerId,
  reasoningEffort,
  workspacePath,
}: UseGitCommitInput): UseGitCommitResult {
  const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
  useGitSourceControlWatcher(normalizedWorkspacePath)
  const [status, setStatus] = useState<GitStatusResult | null>(() => getCachedGitStatus(normalizedWorkspacePath))
  const [isLoadingStatus, setIsLoadingStatus] = useState(false)
  const [isCommitting, setIsCommitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lastCommitResult, setLastCommitResult] = useState<GitCommitResult | null>(null)
  const statusRequestIdRef = useRef(0)
  const commitRequestIdRef = useRef(0)
  const activeWorkspacePathRef = useRef(normalizedWorkspacePath)

  useEffect(() => {
    activeWorkspacePathRef.current = normalizedWorkspacePath
    setStatus(null)
    setIsLoadingStatus(false)
    setIsCommitting(false)
    setErrorMessage(null)
    setLastCommitResult(null)
  }, [normalizedWorkspacePath])

  const refreshStatus = useCallback(async (options?: { forceRefresh?: boolean }) => {
    const requestWorkspacePath = normalizeGitWorkspacePath(workspacePath)
    if (!requestWorkspacePath) {
      if (requestWorkspacePath === activeWorkspacePathRef.current) {
        setStatus(EMPTY_STATUS)
        setIsLoadingStatus(false)
        setErrorMessage(null)
      }
      return
    }

    const requestId = statusRequestIdRef.current + 1
    statusRequestIdRef.current = requestId
    setIsLoadingStatus(true)
    setErrorMessage(null)

    try {
      const nextStatus = await loadGitStatus(requestWorkspacePath, {
        forceRefresh: options?.forceRefresh,
      })
      if (requestId === statusRequestIdRef.current && requestWorkspacePath === activeWorkspacePathRef.current) {
        setStatus(nextStatus)
      }
    } catch (error) {
      if (requestId === statusRequestIdRef.current && requestWorkspacePath === activeWorkspacePathRef.current) {
        setStatus(EMPTY_STATUS)
        setErrorMessage(toUserFacingErrorMessage(error, 'The Git status could not be loaded.'))
      }
    } finally {
      if (requestId === statusRequestIdRef.current && requestWorkspacePath === activeWorkspacePathRef.current) {
        setIsLoadingStatus(false)
      }
    }
  }, [workspacePath])

  useEffect(() => {
    if (!normalizedWorkspacePath) {
      setStatus(null)
      return
    }

    void refreshStatus({ forceRefresh: false })
  }, [normalizedWorkspacePath, refreshStatus])

  useEffect(() => {
    if (!normalizedWorkspacePath) {
      return
    }

    const comparableWorkspacePath = normalizeWorkspaceRootPathForComparison(normalizedWorkspacePath)
    const unsubscribe = window.tidecodeGit.onSourceControlChange((event) => {
      if (normalizeWorkspaceRootPathForComparison(event.workspacePath) !== comparableWorkspacePath) {
        return
      }

      void refreshStatus({ forceRefresh: true })
    })

    return () => {
      unsubscribe()
    }
  }, [normalizedWorkspacePath, refreshStatus])

  useEffect(() => {
    if (!workspacePath) {
      return
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'hidden') {
        return
      }

      void refreshStatus({ forceRefresh: true })
    }, GIT_STATUS_POLL_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [refreshStatus, workspacePath])

  const commit = useCallback(async (input: {
    action: GitCommitAction
    includeUnstaged?: boolean
    message: string
    preferredBranchName?: string
  }): Promise<GitCommitResult | null> => {
    const requestWorkspacePath = normalizeGitWorkspacePath(workspacePath)
    if (!requestWorkspacePath) {
      throw new Error('Workspace path is required.')
    }

    const requestId = commitRequestIdRef.current + 1
    commitRequestIdRef.current = requestId
    setIsCommitting(true)
    setErrorMessage(null)
    const pendingCommitOperation = beginSourceControlCommitOperation(requestWorkspacePath, input.action)

    try {
      const result = await window.tidecodeGit.commit({
        action: input.action,
        includeUnstaged: input.includeUnstaged,
        message: input.message,
        modelId: modelId.trim(),
        preferredBranchName: input.preferredBranchName,
        providerId: providerId ?? undefined,
        reasoningEffort,
        workspacePath: requestWorkspacePath,
      })

      if (
        requestId !== commitRequestIdRef.current ||
        requestWorkspacePath !== activeWorkspacePathRef.current
      ) {
        return null
      }

      setLastCommitResult(result)
      return result
    } catch (error) {
      if (
        requestId !== commitRequestIdRef.current ||
        requestWorkspacePath !== activeWorkspacePathRef.current
      ) {
        return null
      }

      const message = toUserFacingErrorMessage(error, 'The changes could not be committed.')
      setErrorMessage(message)
      throw error instanceof Error ? error : new Error(message)
    } finally {
      if (pendingCommitOperation) {
        endSourceControlCommitOperation(requestWorkspacePath, pendingCommitOperation.sequence)
      }
      if (requestWorkspacePath === activeWorkspacePathRef.current) {
        setIsCommitting(false)
      }
    }
  }, [modelId, providerId, reasoningEffort, workspacePath])

  const resetResult = useCallback(() => {
    setLastCommitResult(null)
    setErrorMessage(null)
  }, [])

  return {
    commit,
    errorMessage,
    isCommitting,
    isLoadingStatus,
    lastCommitResult,
    modelSelection: {
      modelId: modelId.trim(),
      providerId,
      reasoningEffort,
    },
    refreshStatus,
    resetResult,
    status,
  }
}

export type GitCommitController = ReturnType<typeof useGitCommit>
