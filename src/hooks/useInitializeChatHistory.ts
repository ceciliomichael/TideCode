import { useEffect } from 'react'
import { loadGitBranchState, prefetchGitBranchStates } from '../lib/gitBranchStateCache'
import { prefetchGitStatuses } from '../lib/gitStatusCache'
import { loadInitialChatHistory } from './chatHistoryWorkflows'

interface UseInitializeChatHistoryInput {
  enabled: boolean
  initializeHistory: (snapshot: Awaited<ReturnType<typeof loadInitialChatHistory>>) => void
  preferredDraftFolderId: string | null
  preferredConversationId: string | null
  openEmptyConversationOnLaunch: boolean
  setError: (errorMessage: string | null) => void
  setIsLoading: (isLoading: boolean) => void
}

export function useInitializeChatHistory(input: UseInitializeChatHistoryInput) {
  const {
    enabled,
    initializeHistory,
    openEmptyConversationOnLaunch,
    preferredConversationId,
    preferredDraftFolderId,
    setError,
    setIsLoading,
  } = input
  useEffect(() => {
    if (!enabled) {
      return
    }

    // React StrictMode intentionally runs effects through a setup/cleanup/setup cycle in
    // development. Do not guard this effect with a persistent "did start" ref: the first
    // async request is cancelled by cleanup, so the second setup must be allowed to start.
    let isMounted = true

    async function initializeConversations() {
      try {
        const snapshot = await loadInitialChatHistory(
          preferredConversationId,
          openEmptyConversationOnLaunch,
          preferredDraftFolderId,
        )
        const initialWorkspacePath = snapshot.initialConversation?.agentContextRootPath ?? null

        if (!isMounted) {
          return
        }

        initializeHistory(snapshot)
        const workspacePaths = [
          ...snapshot.folderSummaries.map((folderSummary) => folderSummary.path),
          ...snapshot.conversationSummaries.map((conversationSummary) => conversationSummary.agentContextRootPath),
        ]
        void prefetchGitStatuses(workspacePaths)
        window.setTimeout(() => {
          if (initialWorkspacePath) {
            void loadGitBranchState(initialWorkspacePath).catch(() => undefined)
          }

          void prefetchGitBranchStates(workspacePaths)
        }, 250)
      } catch (caughtError) {
        console.error(caughtError)
        if (isMounted) {
          setError('Unable to load saved conversations.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void initializeConversations()

    return () => {
      isMounted = false
    }
  }, [
    enabled,
    initializeHistory,
    openEmptyConversationOnLaunch,
    preferredConversationId,
    preferredDraftFolderId,
    setError,
    setIsLoading,
  ])
}
