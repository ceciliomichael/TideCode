import { useEffect, useRef } from 'react'
import { createSingleFlightTask, type SingleFlightTask } from '../lib/singleFlightTask'
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

        if (!isMounted) {
          return
        }

        initializeHistory(snapshot)
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
