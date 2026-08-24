import { useEffect, useRef } from 'react'
import { loadGitBranchState, prefetchGitBranchStates } from '../lib/gitBranchStateCache'
import { prefetchGitStatuses } from '../lib/gitStatusCache'
import { createSingleFlightTask, type SingleFlightTask } from '../lib/singleFlightTask'
import { scheduleStartupBackgroundTask } from '../lib/startupBackgroundTask'
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
  const initializationTaskRef = useRef<SingleFlightTask<Awaited<ReturnType<typeof loadInitialChatHistory>>> | null>(null)

  useEffect(() => {
    if (!enabled) {
      return
    }

    let isMounted = true
    let cancelBackgroundPrefetch: (() => void) | null = null

    async function initializeConversations() {
      try {
        initializationTaskRef.current ??= createSingleFlightTask(() =>
          loadInitialChatHistory(
            preferredConversationId,
            openEmptyConversationOnLaunch,
            preferredDraftFolderId,
          ),
        )
        const snapshot = await initializationTaskRef.current.run()
        const initialWorkspacePath = snapshot.initialConversation?.agentContextRootPath ?? null

        if (!isMounted) {
          return
        }

        initializeHistory(snapshot)
        const workspacePaths = [
          ...snapshot.folderSummaries.map((folderSummary) => folderSummary.path),
          ...snapshot.conversationSummaries.map((conversationSummary) => conversationSummary.agentContextRootPath),
        ]
        cancelBackgroundPrefetch = scheduleStartupBackgroundTask(
          () => {
            if (initialWorkspacePath) {
              void loadGitBranchState(initialWorkspacePath).catch(() => undefined)
            }

            void prefetchGitStatuses(workspacePaths)
            void prefetchGitBranchStates(workspacePaths)
          },
          { delayMs: 1_500, idleTimeoutMs: 5_000 },
        )
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
      cancelBackgroundPrefetch?.()
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
