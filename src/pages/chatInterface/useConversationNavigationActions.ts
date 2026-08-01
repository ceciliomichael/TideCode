import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { ALL_PROJECTS_FILTER_ID, CHATS_PROJECT_FILTER_ID } from '../../components/sidebar/sidebarProjectThreads'
import type { ChatMessagesController } from '../../hooks/useChatMessages'
import {
  findFolderIdForConversation,
  resolveProjectSwitchTarget,
  shouldResetProjectFilterToAllProjects,
} from '../../lib/projectSelectionUtils'
import type { AppSettings } from '../../types/chat'

interface UseConversationNavigationActionsInput {
  chatMessages: ChatMessagesController
  clearQueuedMessages: () => void
  onCreateWorkspaceFolderFromPath: (folderPath: string) => Promise<void>
  onUpdateSettings: (settings: Partial<AppSettings>) => void
  selectedProjectId: string
  setSelectedProjectId: Dispatch<SetStateAction<string>>
  setWorkspaceViewMode: Dispatch<SetStateAction<'chat' | 'kanban'>>
}

export function useConversationNavigationActions({
  chatMessages,
  clearQueuedMessages,
  onCreateWorkspaceFolderFromPath,
  onUpdateSettings,
  selectedProjectId,
  setSelectedProjectId,
  setWorkspaceViewMode,
}: UseConversationNavigationActionsInput) {
  const handleCreateConversation = useCallback(
    async (folderId?: string | null) => {
      clearQueuedMessages()
      setWorkspaceViewMode('chat')

      const targetFolderId = folderId ?? null
      if (shouldResetProjectFilterToAllProjects(selectedProjectId, targetFolderId)) {
        setSelectedProjectId(ALL_PROJECTS_FILTER_ID)
        void onUpdateSettings({ selectedProjectId: ALL_PROJECTS_FILTER_ID })
      }

      await chatMessages.createConversation(folderId)
    },
    [chatMessages, clearQueuedMessages, onUpdateSettings, selectedProjectId, setSelectedProjectId, setWorkspaceViewMode],
  )

  const handleSelectProject = useCallback(
    (projectId: string) => {
      setSelectedProjectId(projectId)
      onUpdateSettings({ selectedProjectId: projectId })

      const action = resolveProjectSwitchTarget({
        activeConversationId: chatMessages.activeConversationId,
        conversationGroups: chatMessages.conversationGroups,
        currentSelectedFolderId: chatMessages.selectedFolderId,
        projectId,
      })

      if (action.type === 'preserve_active_thread') return
      if (action.type === 'switch_to_conversation') {
        clearQueuedMessages()
        setWorkspaceViewMode('chat')
        void chatMessages.selectConversation(action.conversationId)
        return
      }
      if (action.type === 'create_new_conversation') {
        void handleCreateConversation(action.folderId)
      }
    },
    [chatMessages, clearQueuedMessages, handleCreateConversation, onUpdateSettings, setSelectedProjectId, setWorkspaceViewMode],
  )

  const handleCreateWorkspaceConversation = useCallback(async () => {
    clearQueuedMessages()
    setWorkspaceViewMode('chat')

    const folderId =
      selectedProjectId === ALL_PROJECTS_FILTER_ID
        ? undefined
        : selectedProjectId === CHATS_PROJECT_FILTER_ID
          ? null
          : selectedProjectId
    await chatMessages.createConversation(folderId)
  }, [chatMessages, clearQueuedMessages, selectedProjectId, setWorkspaceViewMode])

  const handleSelectConversation = useCallback(
    (conversationId: string) => {
      clearQueuedMessages()
      setWorkspaceViewMode('chat')

      const conversationFolderId = findFolderIdForConversation(chatMessages.conversationGroups, conversationId)
      if (
        conversationFolderId !== undefined &&
        shouldResetProjectFilterToAllProjects(selectedProjectId, conversationFolderId)
      ) {
        setSelectedProjectId(ALL_PROJECTS_FILTER_ID)
        void onUpdateSettings({ selectedProjectId: ALL_PROJECTS_FILTER_ID })
      }

      void chatMessages.selectConversation(conversationId)
    },
    [chatMessages, clearQueuedMessages, onUpdateSettings, selectedProjectId, setSelectedProjectId, setWorkspaceViewMode],
  )

  const handleCreateFolder = useCallback(async () => {
    clearQueuedMessages()
    await chatMessages.createFolder()
  }, [chatMessages, clearQueuedMessages])

  const handleCreateWorkspaceFolderFromPath = useCallback(
    async (folderPath: string) => {
      clearQueuedMessages()
      await onCreateWorkspaceFolderFromPath(folderPath)
    },
    [clearQueuedMessages, onCreateWorkspaceFolderFromPath],
  )

  const handleDeleteConversation = useCallback(
    (conversationId: string) => {
      clearQueuedMessages()
      void chatMessages.deleteConversation(conversationId)
    },
    [chatMessages, clearQueuedMessages],
  )

  const handlePinConversation = useCallback(
    (conversationId: string, isPinned: boolean) => {
      void chatMessages.pinConversation(conversationId, isPinned)
    },
    [chatMessages],
  )

  const handleDeleteFolder = useCallback(
    async (folderId: string) => {
      clearQueuedMessages()
      await chatMessages.deleteFolder(folderId)
    },
    [chatMessages, clearQueuedMessages],
  )

  return {
    handleCreateConversation,
    handleCreateFolder,
    handleCreateWorkspaceConversation,
    handleCreateWorkspaceFolderFromPath,
    handleDeleteConversation,
    handleDeleteFolder,
    handlePinConversation,
    handleSelectConversation,
    handleSelectProject,
  }
}
