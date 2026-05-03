import { useCallback, useMemo, useState } from 'react'
import type {
  AssistantWaitingIndicatorVariant,
  ChatMode,
  ConversationFolderSummary,
  ConversationRecord,
  ReorderConversationFolderInput,
  ConversationSummary,
  Message,
} from '../types/chat'
import {
  buildConversationGroups,
  getFolderIdForWorkspacePath,
  getSelectedFolderName,
  insertFolderSummary,
  moveFolderSummary,
  reorderFolderSummary,
  removeConversationSummary,
  upsertConversationSummary,
} from './chatHistoryViewModels'
import type { ChatHistorySnapshot } from './chatHistoryWorkflows'
import type { AppLanguage } from '../lib/appSettings'

interface ConversationRuntimeState {
  conversation: ConversationRecord
  isSending: boolean
  activeStreamId: string | null
  isStreamingTextActive: boolean
  streamingAssistantMessageId: string | null
  streamingWaitingIndicatorVariant: AssistantWaitingIndicatorVariant | null
}

type ConversationRuntimeStateMap = Record<string, ConversationRuntimeState>

interface UpdateConversationRuntimeInput {
  activeStreamId?: string | null
  isSending?: boolean
  isStreamingTextActive?: boolean
  streamingAssistantMessageId?: string | null
  streamingWaitingIndicatorVariant?: AssistantWaitingIndicatorVariant | null
}

function createConversationRuntimeState(
  conversation: ConversationRecord,
  currentValue?: ConversationRuntimeState,
): ConversationRuntimeState {
  return {
    activeStreamId: currentValue?.activeStreamId ?? null,
    conversation,
    isSending: currentValue?.isSending ?? false,
    isStreamingTextActive: currentValue?.isStreamingTextActive ?? false,
    streamingAssistantMessageId: currentValue?.streamingAssistantMessageId ?? null,
    streamingWaitingIndicatorVariant: currentValue?.streamingWaitingIndicatorVariant ?? null,
  }
}

function updateConversationRecord(
  runtimeState: ConversationRuntimeState,
  updater: (conversation: ConversationRecord) => ConversationRecord,
) {
  return {
    ...runtimeState,
    conversation: updater(runtimeState.conversation),
  }
}

export function useChatSessionState(language: AppLanguage) {
  const [conversationSummaries, setConversationSummaries] = useState<ConversationSummary[]>([])
  const [folderSummaries, setFolderSummaries] = useState<ConversationFolderSummary[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [activeConversationChatMode, setActiveConversationChatMode] = useState<ChatMode | null>(null)
  const [conversationRuntimeStates, setConversationRuntimeStates] = useState<ConversationRuntimeStateMap>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const activeConversationState = activeConversationId ? conversationRuntimeStates[activeConversationId] ?? null : null
  const runningConversationIds = useMemo(
    () =>
      new Set(
        Object.values(conversationRuntimeStates)
          .filter((conversationState) => conversationState.isSending || conversationState.activeStreamId !== null)
          .map((conversationState) => conversationState.conversation.id),
      ),
    [conversationRuntimeStates],
  )

  const clearConversationSelection = useCallback((nextFolderId: string | null) => {
    setActiveConversationId(null)
    setActiveConversationChatMode(null)
    setSelectedFolderId(nextFolderId)
  }, [])

  const setActiveConversationSelection = useCallback(
    (conversation: ConversationRecord, selectedFolderIdOverride: string | null = conversation.folderId) => {
      setActiveConversationId(conversation.id)
      setActiveConversationChatMode(conversation.chatMode)
      setSelectedFolderId(selectedFolderIdOverride)
    },
    [],
  )

  const upsertConversationRecord = useCallback((conversation: ConversationRecord) => {
    setConversationRuntimeStates((currentValue) => ({
      ...currentValue,
      [conversation.id]: createConversationRuntimeState(conversation, currentValue[conversation.id]),
    }))
  }, [])

  const applyConversation = useCallback(
    (conversation: ConversationRecord) => {
      upsertConversationRecord(conversation)
      setActiveConversationSelection(conversation)
    },
    [setActiveConversationSelection, upsertConversationRecord],
  )

  const initializeHistory = useCallback(
    ({
      conversationSummaries: nextConversationSummaries,
      folderSummaries: nextFolderSummaries,
      initialConversation,
      initialSelectedFolderId,
    }: ChatHistorySnapshot) => {
      setConversationSummaries(nextConversationSummaries)
      setFolderSummaries(nextFolderSummaries)

      if (!initialConversation) {
        clearConversationSelection(initialSelectedFolderId)
        return
      }

      const normalizedInitialSelectedFolderId =
        initialConversation.folderId !== null &&
        nextFolderSummaries.some((folder) => folder.id === initialConversation.folderId)
          ? initialConversation.folderId
          : null

      setConversationRuntimeStates((currentValue) => ({
        ...currentValue,
        [initialConversation.id]: createConversationRuntimeState(initialConversation, currentValue[initialConversation.id]),
      }))
      setActiveConversationSelection(initialConversation, normalizedInitialSelectedFolderId)
    },
    [clearConversationSelection, setActiveConversationSelection],
  )

  const addFolder = useCallback((folder: ConversationFolderSummary) => {
    setFolderSummaries((currentValue) => insertFolderSummary(currentValue, folder))
  }, [])

  const renameFolder = useCallback((folderId: string, name: string) => {
    setFolderSummaries((currentValue) =>
      currentValue.map((folder) => (folder.id === folderId ? { ...folder, name } : folder)),
    )
  }, [])

  const moveFolder = useCallback((folderId: string, direction: 'up' | 'down') => {
    setFolderSummaries((currentValue) => moveFolderSummary(currentValue, folderId, direction))
  }, [])

  const reorderFolder = useCallback((input: ReorderConversationFolderInput) => {
    setFolderSummaries((currentValue) => reorderFolderSummary(currentValue, input))
  }, [])

  const removeFolder = useCallback(
    (folderId: string, deletedConversationIds: readonly string[]) => {
      const deletedConversationIdSet = new Set(deletedConversationIds)

      setFolderSummaries((currentValue) => currentValue.filter((folder) => folder.id !== folderId))
      setConversationSummaries((currentValue) =>
        currentValue.filter((conversation) => !deletedConversationIdSet.has(conversation.id)),
      )
      setConversationRuntimeStates((currentValue) => {
        if (deletedConversationIdSet.size === 0) {
          return currentValue
        }

        let hasChanges = false
        const nextConversationStates: ConversationRuntimeStateMap = {}

        for (const [conversationId, conversationState] of Object.entries(currentValue)) {
          if (deletedConversationIdSet.has(conversationId)) {
            hasChanges = true
            continue
          }

          nextConversationStates[conversationId] = conversationState
        }

        return hasChanges ? nextConversationStates : currentValue
      })
      setSelectedFolderId((currentValue) => (currentValue === folderId ? null : currentValue))
      if (activeConversationId && deletedConversationIdSet.has(activeConversationId)) {
        setActiveConversationId(null)
        setActiveConversationChatMode(null)
      }
    },
    [activeConversationId],
  )

  const upsertConversationSummaryOnly = useCallback((conversation: ConversationRecord) => {
    setConversationSummaries((currentValue) => upsertConversationSummary(currentValue, conversation))
  }, [])

  const upsertConversation = useCallback(
    (conversation: ConversationRecord) => {
      upsertConversationRecord(conversation)
      upsertConversationSummaryOnly(conversation)
    },
    [upsertConversationRecord, upsertConversationSummaryOnly],
  )

  const updateConversationRuntimeState = useCallback(
    (conversationId: string, input: UpdateConversationRuntimeInput) => {
      setConversationRuntimeStates((currentValue) => {
        const conversationState = currentValue[conversationId]
        if (!conversationState) {
          return currentValue
        }

        return {
          ...currentValue,
          [conversationId]: {
            ...conversationState,
            ...(input.activeStreamId !== undefined ? { activeStreamId: input.activeStreamId } : {}),
            ...(input.isSending !== undefined ? { isSending: input.isSending } : {}),
            ...(input.isStreamingTextActive !== undefined
              ? { isStreamingTextActive: input.isStreamingTextActive }
              : {}),
            ...(input.streamingAssistantMessageId !== undefined
              ? { streamingAssistantMessageId: input.streamingAssistantMessageId }
              : {}),
            ...(input.streamingWaitingIndicatorVariant !== undefined
              ? { streamingWaitingIndicatorVariant: input.streamingWaitingIndicatorVariant }
              : {}),
          },
        }
      })
    },
    [],
  )

  const appendLocalMessage = useCallback((conversationId: string, message: Message) => {
    setConversationRuntimeStates((currentValue) => {
      const conversationState = currentValue[conversationId]
      if (!conversationState) {
        return currentValue
      }

      return {
        ...currentValue,
        [conversationId]: updateConversationRecord(conversationState, (conversation) => ({
          ...conversation,
          messages: [...conversation.messages, message],
        })),
      }
    })
  }, [])

  const insertLocalMessagesBefore = useCallback((conversationId: string, targetMessageId: string, nextMessages: Message[]) => {
    if (nextMessages.length === 0) {
      return
    }

    setConversationRuntimeStates((currentValue) => {
      const conversationState = currentValue[conversationId]
      if (!conversationState) {
        return currentValue
      }

      const targetMessageIndex = conversationState.conversation.messages.findIndex((message) => message.id === targetMessageId)
      const nextConversationMessages =
        targetMessageIndex < 0
          ? [...conversationState.conversation.messages, ...nextMessages]
          : [
              ...conversationState.conversation.messages.slice(0, targetMessageIndex),
              ...nextMessages,
              ...conversationState.conversation.messages.slice(targetMessageIndex),
            ]

      return {
        ...currentValue,
        [conversationId]: updateConversationRecord(conversationState, (conversation) => ({
          ...conversation,
          messages: nextConversationMessages,
        })),
      }
    })
  }, [])

  const removeLocalMessage = useCallback((conversationId: string, messageId: string) => {
    setConversationRuntimeStates((currentValue) => {
      const conversationState = currentValue[conversationId]
      if (!conversationState) {
        return currentValue
      }

      return {
        ...currentValue,
        [conversationId]: updateConversationRecord(conversationState, (conversation) => ({
          ...conversation,
          messages: conversation.messages.filter((message) => message.id !== messageId),
        })),
      }
    })
  }, [])

  const updateLocalMessage = useCallback((conversationId: string, messageId: string, updater: (message: Message) => Message) => {
    setConversationRuntimeStates((currentValue) => {
      const conversationState = currentValue[conversationId]
      if (!conversationState) {
        return currentValue
      }

      return {
        ...currentValue,
        [conversationId]: updateConversationRecord(conversationState, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) => (message.id === messageId ? updater(message) : message)),
        })),
      }
    })
  }, [])

  const getDeletionContext = useCallback(
    (conversationId: string) => {
      return {
        deletedConversationFolderId:
          conversationSummaries.find((conversation) => conversation.id === conversationId)?.folderId ?? null,
        remainingSummaries: removeConversationSummary(conversationSummaries, conversationId),
      }
    },
    [conversationSummaries],
  )

  const removeConversationRuntime = useCallback((conversationId: string) => {
    setConversationRuntimeStates((currentValue) => {
      if (!(conversationId in currentValue)) {
        return currentValue
      }

      const nextConversationStates = { ...currentValue }
      delete nextConversationStates[conversationId]
      return nextConversationStates
    })
  }, [])

  const clearError = useCallback(() => setError(null), [])
  const resolveFolderIdForWorkspacePath = useCallback(
    (workspacePath: string | null) => getFolderIdForWorkspacePath(folderSummaries, workspacePath),
    [folderSummaries],
  )

  return {
    activeConversationChatMode,
    activeConversationId,
    activeConversationState,
    activeConversationTitle:
      conversationSummaries.find((conversation) => conversation.id === activeConversationId)?.title ?? 'New thread',
    addFolder,
    applyConversation,
    clearConversationSelection,
    clearError,
    conversationGroups: buildConversationGroups(
      folderSummaries,
      conversationSummaries,
      activeConversationId,
      selectedFolderId,
      runningConversationIds,
      language,
    ),
    conversationRuntimeStates,
    error,
    getDeletionContext,
    initializeHistory,
    isLoading,
    removeFolder,
    removeConversationRuntime,
    moveFolder,
    reorderFolder,
    renameFolder,
    replaceConversationSummaries: setConversationSummaries,
    runningConversationIds,
    selectedFolderId,
    selectedFolderName: getSelectedFolderName(folderSummaries, selectedFolderId),
    selectedFolderPath: selectedFolderId === null ? null : folderSummaries.find((folder) => folder.id === selectedFolderId)?.path ?? null,
    resolveFolderIdForWorkspacePath,
    setError,
    setIsLoading,
    updateConversationRuntimeState,
    updateConversationSummary: upsertConversationSummaryOnly,
    updateLocalMessage,
    insertLocalMessagesBefore,
    appendLocalMessage,
    removeLocalMessage,
    upsertConversation,
  }
}
