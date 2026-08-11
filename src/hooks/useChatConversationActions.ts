import { useCallback, useRef } from 'react'
import type {
  ConversationFolderSummary,
  ConversationRecord,
  ConversationSummary,
  ReorderConversationFolderInput,
} from '../types/chat'
import { loadChatCompactionMarkers } from '../lib/chatCompactionMarkerCache'
import type { ConversationRuntimeSnapshot } from './chatMessageSendTypes'

interface UseChatConversationActionsInput {
  activeConversationId: string | null
  activeWorkspacePath: string | null
  addFolder: (folder: ConversationFolderSummary) => void
  applyConversation: (conversation: ConversationRecord) => void
  beginEditingMessage: (messageId: string) => void
  clearConversationSelection: (nextFolderId: string | null) => void
  clearError: () => void
  conversationRuntimeStatesRef: { current: Record<string, ConversationRuntimeSnapshot> }
  getDeletionContext: (conversationId: string) => {
    deletedConversationFolderId: string | null
    remainingSummaries: ConversationSummary[]
  }
  removeFolder: (folderId: string, deletedConversationIds: readonly string[]) => void
  removeConversationRuntime: (conversationId: string) => void
  reorderFolder: (input: ReorderConversationFolderInput) => void
  renameFolder: (folderId: string, name: string) => void
  replaceConversationSummaries: (summaries: ConversationSummary[]) => void
  resetComposerState: () => void
  selectedFolderId: string | null
  resolveFolderIdForWorkspacePath: (workspacePath: string | null) => string | null
  setError: (errorMessage: string | null) => void
  upsertConversation: (conversation: ConversationRecord) => void
}

export function useChatConversationActions(input: UseChatConversationActionsInput) {
  const {
    activeConversationId,
    activeWorkspacePath,
    addFolder,
    applyConversation,
    beginEditingMessage,
    clearConversationSelection,
    clearError,
    conversationRuntimeStatesRef,
    getDeletionContext,
    removeFolder,
    removeConversationRuntime,
    reorderFolder: applyFolderReorder,
    renameFolder,
    replaceConversationSummaries,
    resetComposerState,
    selectedFolderId,
    resolveFolderIdForWorkspacePath,
    setError,
    upsertConversation,
  } = input
  const conversationSelectionRequestRef = useRef(0)
  const requestedConversationIdRef = useRef(activeConversationId)

  const resetDraft = useCallback(
    (nextFolderId: string | null) => {
      conversationSelectionRequestRef.current += 1
      requestedConversationIdRef.current = null
      resetComposerState()
      clearConversationSelection(nextFolderId)
    },
    [clearConversationSelection, resetComposerState],
  )

  const prepareNewConversation = useCallback(
    (folderId?: string | null) => {
      clearError()
      const nextFolderId =
        folderId !== undefined
          ? folderId
          : selectedFolderId ?? resolveFolderIdForWorkspacePath(activeWorkspacePath)

      resetDraft(nextFolderId)
      return nextFolderId
    },
    [activeWorkspacePath, clearError, resolveFolderIdForWorkspacePath, resetDraft, selectedFolderId],
  )

  const createFolder = useCallback(async () => {
    clearError()

    try {
      const folder = await window.tidecodeHistory.pickFolder()
      if (!folder) {
        return
      }

      addFolder(folder)
      resetDraft(folder.id)
      return folder.id
    } catch (caughtError) {
      console.error(caughtError)
      setError('Unable to create that folder.')
      throw caughtError
    }
  }, [addFolder, clearError, resetDraft, setError])

  const createWorkspaceFolderFromPath = useCallback(
    async (folderPath: string) => {
      clearError()

      try {
        const folder = await window.tidecodeHistory.createFolderFromPath(folderPath)
        addFolder(folder)
        resetDraft(folder.id)
        return folder.id
      } catch (caughtError) {
        console.error(caughtError)
        setError('Unable to create that folder.')
        throw caughtError
      }
    },
    [addFolder, clearError, resetDraft, setError],
  )

  const selectFolder = useCallback(
    (folderId: string | null) => {
      clearError()
      resetDraft(folderId)
      return folderId
    },
    [clearError, resetDraft],
  )

  const selectConversation = useCallback(
    async (conversationId: string) => {
      if (
        conversationId === activeConversationId &&
        requestedConversationIdRef.current === conversationId
      ) {
        return
      }

      const requestId = conversationSelectionRequestRef.current + 1
      conversationSelectionRequestRef.current = requestId
      requestedConversationIdRef.current = conversationId
      clearError()
      resetComposerState()

      const markerPreload = Promise.resolve()
        .then(() => loadChatCompactionMarkers(conversationId))
        .catch((caughtError) => {
          console.error(`Failed to preload chat compaction markers: ${conversationId}`, caughtError)
        })
      const cachedConversation = conversationRuntimeStatesRef.current[conversationId]?.conversation
      if (cachedConversation) {
        await markerPreload
        if (conversationSelectionRequestRef.current === requestId) {
          applyConversation(cachedConversation)
        }
        return
      }

      try {
        const [conversation] = await Promise.all([
          window.tidecodeHistory.getConversation(conversationId),
          markerPreload,
        ])
        if (conversationSelectionRequestRef.current !== requestId) {
          return
        }

        if (!conversation) {
          setError('That conversation could not be loaded.')
          return
        }

        applyConversation(conversation)
      } catch (caughtError) {
        console.error(caughtError)
        if (conversationSelectionRequestRef.current === requestId) {
          setError('Unable to switch conversations.')
        }
      }
    },
    [activeConversationId, applyConversation, clearError, conversationRuntimeStatesRef, resetComposerState, setError],
  )

  const startEditingMessage = useCallback(
    (messageId: string) => {
      clearError()
      beginEditingMessage(messageId)
    },
    [beginEditingMessage, clearError],
  )

  const deleteConversation = useCallback(
    async (conversationId: string) => {
      clearError()

      const conversationState = conversationRuntimeStatesRef.current[conversationId] ?? null
      if (conversationState?.isSending && conversationState.activeStreamId === null) {
        setError('Wait for the current thread task to initialize before deleting it.')
        return
      }

      if (conversationState?.activeStreamId) {
        try {
          await window.tidecodeChat.cancelStream(conversationState.activeStreamId)
        } catch (caughtError) {
          console.error(caughtError)
          setError('Unable to stop the current thread task before deleting it.')
          return
        }
      }

      const { deletedConversationFolderId, remainingSummaries } = getDeletionContext(conversationId)

      if (conversationId === activeConversationId) {
        resetComposerState()
      }

      try {
        await window.tidecodeHistory.deleteConversation(conversationId)
        removeConversationRuntime(conversationId)
        replaceConversationSummaries(remainingSummaries)

        if (conversationId !== activeConversationId) {
          return
        }

        resetDraft(deletedConversationFolderId)
      } catch (caughtError) {
        console.error(caughtError)
        setError('Unable to delete that conversation.')
      }
    },
    [
      activeConversationId,
      clearError,
      conversationRuntimeStatesRef,
      getDeletionContext,
      removeConversationRuntime,
      replaceConversationSummaries,
      resetComposerState,
      resetDraft,
      setError,
    ],
  )

  const archiveConversation = useCallback(
    async (conversationId: string, isArchived: boolean) => {
      clearError()

      const conversationState = conversationRuntimeStatesRef.current[conversationId] ?? null
      if (isArchived && conversationState?.isSending) {
        setError('Wait for the current thread task to finish before archiving it.')
        return
      }

      try {
        const conversation = await window.tidecodeHistory.updateConversationArchived(conversationId, isArchived)
        upsertConversation(conversation)
        if (conversationId === activeConversationId) {
          if (isArchived) {
            resetDraft(conversation.folderId)
          } else {
            applyConversation(conversation)
          }
        }
      } catch (caughtError) {
        console.error(caughtError)
        setError(isArchived ? 'Unable to archive that thread.' : 'Unable to unarchive that thread.')
      }
    },
    [activeConversationId, applyConversation, clearError, conversationRuntimeStatesRef, resetDraft, setError, upsertConversation],
  )

  return {
    prepareNewConversation,
    createFolder,
    createWorkspaceFolderFromPath,
    archiveConversation,
    deleteConversation,
    renameConversationTitle: async (conversationId: string, title: string) => {
      clearError()

      try {
        const conversation = await window.tidecodeHistory.updateConversationTitle(conversationId, title)
        upsertConversation(conversation)
        if (conversationId === activeConversationId) {
          applyConversation(conversation)
        }
      } catch (caughtError) {
        console.error(caughtError)
        setError('Unable to rename that thread.')
        throw caughtError
      }
    },
    pinConversation: async (conversationId: string, isPinned: boolean) => {
      clearError()

      try {
        const conversation = await window.tidecodeHistory.updateConversationPinned(conversationId, isPinned)
        upsertConversation(conversation)
        if (conversationId === activeConversationId) {
          applyConversation(conversation)
        }
      } catch (caughtError) {
        console.error(caughtError)
        setError('Unable to pin that thread.')
        throw caughtError
      }
    },
    renameFolder: async (folderId: string, name: string) => {
      clearError()

      try {
        const folder = await window.tidecodeHistory.renameFolder({
          folderId,
          name,
        })
        renameFolder(folder.id, folder.name)
      } catch (caughtError) {
        console.error(caughtError)
        setError('Unable to rename that project folder.')
        throw caughtError
      }
    },
    deleteFolder: async (folderId: string) => {
      clearError()

      try {
        const deletedConversationIds = await window.tidecodeHistory.deleteFolder(folderId)
        removeFolder(folderId, deletedConversationIds)
      } catch (caughtError) {
        console.error(caughtError)
        setError('Unable to remove that project folder.')
        throw caughtError
      }
    },
    reorderFolder: async (input: ReorderConversationFolderInput) => {
      clearError()
      applyFolderReorder(input)

      try {
        await window.tidecodeHistory.reorderFolder(input)
      } catch (caughtError) {
        console.error(caughtError)
        setError('Unable to reorder that project folder.')
        throw caughtError
      }
    },
    selectConversation,
    selectFolder,
    startEditingMessage,
  }
}
