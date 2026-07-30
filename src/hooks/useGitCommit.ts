import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatProviderId, GitCommitAction, GitCommitResult, GitStatusResult, ReasoningEffort } from '../types/chat'
import { normalizeGitWorkspacePath } from '../lib/gitBranchStateCache'
import {
  beginSourceControlCommitOperation,
  endSourceControlCommitOperation,
} from '../lib/sourceControlPendingStateStore'

interface UseGitCommitInput {
  hasRepository: boolean
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
  refreshStatus: () => Promise<void>
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
  hasRepository,
  modelId,
  providerId,
  reasoningEffort,
  workspacePath,
}: UseGitCommitInput): UseGitCommitResult {
  const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
  const [status, setStatus] = useState<GitStatusResult | null>(null)
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

  const refreshStatus = useCallback(async () => {
    const requestWorkspacePath = normalizeGitWorkspacePath(workspacePath)
    if (!requestWorkspacePath || !hasRepository) {
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
      const nextStatus = await window.echosphereGit.getStatus(requestWorkspacePath)
      if (requestId === statusRequestIdRef.current && requestWorkspacePath === activeWorkspacePathRef.current) {
        setStatus(nextStatus)
      }
    } catch (error) {
      if (requestId === statusRequestIdRef.current && requestWorkspacePath === activeWorkspacePathRef.current) {
        setStatus(EMPTY_STATUS)
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load git status.')
      }
    } finally {
      if (requestId === statusRequestIdRef.current && requestWorkspacePath === activeWorkspacePathRef.current) {
        setIsLoadingStatus(false)
      }
    }
  }, [hasRepository, workspacePath])

  useEffect(() => {
    if (!hasRepository) {
      setStatus(null)
      return
    }

    void refreshStatus()
  }, [hasRepository, refreshStatus])

  useEffect(() => {
    if (!hasRepository || !workspacePath) {
      return
    }

    const unsubscribe = window.echosphereWorkspace.onExplorerChange(() => {
      void refreshStatus()
    })

    return () => {
      unsubscribe()
    }
  }, [hasRepository, refreshStatus, workspacePath])

  useEffect(() => {
    if (!hasRepository || !workspacePath) {
      return
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'hidden') {
        return
      }

      void refreshStatus()
    }, GIT_STATUS_POLL_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [hasRepository, refreshStatus, workspacePath])

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
      const result = await window.echosphereGit.commit({
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

      const nextError = error instanceof Error ? error : new Error('Failed to commit changes.')
      setErrorMessage(nextError.message)
      throw nextError
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
    refreshStatus,
    resetResult,
    status,
  }
}

export type GitCommitController = ReturnType<typeof useGitCommit>
