import { useCallback, useEffect, useRef, useState } from 'react'
import { buildRevertSessionKey, mergeConversationEditSessions } from './chatEditSessions'
import type { ChatRuntimeSelection } from './chatMessageRuntime'
import { useChatComposerState, type EditComposerDraftSession } from './useChatComposerState'
import { useChatConversationActions } from './useChatConversationActions'
import { useChatSendActions } from './useChatSendActions'
import { useChatSessionState } from './useChatSessionState'
import { useChatStreamingState } from './useChatStreamingState'
import { useInitializeChatHistory } from './useInitializeChatHistory'
import type { AppLanguage } from '../lib/appSettings'
import type { ChatMode, ConversationEditSession, ConversationModelPreference, Message, RevertEditSession } from '../types/chat'

const EMPTY_MESSAGES: Message[] = []

interface UseChatMessagesInput {
  conversationModelPreferences: Record<string, ConversationModelPreference>
  editSessionsByConversation: Record<string, ConversationEditSession>
  language: AppLanguage
  onPersistConversationModelPreferences: (nextValue: Record<string, ConversationModelPreference>) => void
  persistConversationLaunchPreference: (input: {
    conversationId: string | null
    draftFolderId: string | null
    openEmptyConversationOnLaunch: boolean
  }) => void
  persistEditSessionsByConversation: (nextValue: Record<string, ConversationEditSession>) => void
  preferredDraftFolderId: string | null
  preferredConversationId: string | null
  revertEditSessionsByConversation: Record<string, RevertEditSession>
  persistRevertEditSessionsByConversation: (nextValue: Record<string, RevertEditSession>) => void
  openEmptyConversationOnLaunch: boolean
  shouldInitializeHistory: boolean
}

export function useChatMessages(input: UseChatMessagesInput) {
  const {
    conversationModelPreferences,
    editSessionsByConversation: persistedEditSessionsByConversation,
    language,
    onPersistConversationModelPreferences,
    persistConversationLaunchPreference,
    persistEditSessionsByConversation,
    persistRevertEditSessionsByConversation,
    preferredDraftFolderId,
    preferredConversationId,
    revertEditSessionsByConversation: persistedRevertEditSessionsByConversation,
    openEmptyConversationOnLaunch,
    shouldInitializeHistory,
  } = input
  const sessionState = useChatSessionState(language)
  const messages = sessionState.activeConversationState?.conversation.messages ?? EMPTY_MESSAGES
  // Read the draft agent context path synchronously so the Explorer panel
  // always has a valid path on the very first render — no "Explorer is waiting" flash.
  const [draftAgentContextPath] = useState<string | null>(() => {
    try {
      return window.tidecodeHistory?.getDraftAgentContextPathSync?.() ?? null
    } catch {
      return null
    }
  })

  // Ensure the VIRT_draft directory exists on disk as a fire-and-forget side-effect.
  // We don't need to await or set state — the path itself is already known synchronously.
  useEffect(() => {
    if (draftAgentContextPath && window.tidecodeHistory?.ensureDraftAgentContext) {
      void window.tidecodeHistory.ensureDraftAgentContext().catch(() => undefined)
    }
  }, [draftAgentContextPath])

  const activeWorkspacePath =
    sessionState.activeConversationState?.conversation.agentContextRootPath ??
    sessionState.selectedFolderPath ??
    draftAgentContextPath
  const composerState = useChatComposerState(messages)
  const activeConversationId = sessionState.activeConversationId
  const setSessionError = sessionState.setError
  const captureComposerEditingSession = composerState.captureEditingSession
  const editingMessageId = composerState.editingMessageId
  const restoreComposerEditingSession = composerState.restoreEditingSession
  const startComposerEditingMessage = composerState.startEditingMessage
  const cancelComposerEditingMessage = composerState.cancelEditingMessage
  const [draftChatMode, setDraftChatMode] = useState<ChatMode>('agent')
  const [pendingDraftSendCount, setPendingDraftSendCount] = useState(0)
  const [editSessionsByConversation, setEditSessionsByConversation] = useState<Record<string, ConversationEditSession>>(
    mergeConversationEditSessions(
      persistedEditSessionsByConversation,
      persistedRevertEditSessionsByConversation,
    ),
  )
  const editSessionsRef = useRef<Record<string, ConversationEditSession>>(editSessionsByConversation)
  const revertEditSessionsRef = useRef<Record<string, RevertEditSession>>(persistedRevertEditSessionsByConversation)
  const draftEditSessionsRef = useRef<Record<string, EditComposerDraftSession>>({})
  const appliedRevertSessionKeysRef = useRef<Record<string, string>>({})
  const resumeSessionKeyRef = useRef<string | null>(null)
  const syncedConversationModeIdRef = useRef<string | null>(null)
  const draftChatModeByConversationRef = useRef<Record<string, ChatMode>>({})

  useEffect(() => {
    const mergedEditSessions = mergeConversationEditSessions(
      persistedEditSessionsByConversation,
      persistedRevertEditSessionsByConversation,
    )
    editSessionsRef.current = mergedEditSessions
    setEditSessionsByConversation(mergedEditSessions)
    revertEditSessionsRef.current = persistedRevertEditSessionsByConversation
  }, [persistedEditSessionsByConversation, persistedRevertEditSessionsByConversation])

  const setPersistedEditSessions = useCallback(
    (nextValue: Record<string, ConversationEditSession>) => {
      editSessionsRef.current = nextValue
      setEditSessionsByConversation(nextValue)
      persistEditSessionsByConversation(nextValue)
    },
    [persistEditSessionsByConversation],
  )

  const upsertEditSession = useCallback(
    (conversationId: string, messageId: string) => {
      const currentValue = editSessionsRef.current
      const existingSession = currentValue[conversationId]
      if (existingSession?.messageId === messageId) {
        return
      }

      setPersistedEditSessions({
        ...currentValue,
        [conversationId]: {
          messageId,
        },
      })
    },
    [setPersistedEditSessions],
  )

  const clearEditSession = useCallback(
    (conversationId: string) => {
      const currentValue = editSessionsRef.current
      if (!(conversationId in currentValue)) {
        return
      }

      const nextValue = { ...currentValue }
      delete nextValue[conversationId]
      setPersistedEditSessions(nextValue)
    },
    [setPersistedEditSessions],
  )

  const setRevertEditSessions = useCallback(
    (nextValue: Record<string, RevertEditSession>) => {
      revertEditSessionsRef.current = nextValue
      persistRevertEditSessionsByConversation(nextValue)
    },
    [persistRevertEditSessionsByConversation],
  )

  const clearRevertEditSession = useCallback(
    (conversationId: string) => {
      const currentValue = revertEditSessionsRef.current
      if (!(conversationId in currentValue)) {
        return
      }

      const nextValue = { ...currentValue }
      delete nextValue[conversationId]
      delete appliedRevertSessionKeysRef.current[conversationId]
      setRevertEditSessions(nextValue)
    },
    [setRevertEditSessions],
  )

  const streamingState = useChatStreamingState({
    activeConversationId: sessionState.activeConversationId,
    conversationRuntimeStates: sessionState.conversationRuntimeStates,
    selectedFolderId: sessionState.selectedFolderId,
    updateConversationRuntimeState: sessionState.updateConversationRuntimeState,
  })

  useInitializeChatHistory({
    enabled: shouldInitializeHistory,
    initializeHistory: sessionState.initializeHistory,
    openEmptyConversationOnLaunch,
    preferredDraftFolderId,
    preferredConversationId,
    setError: sessionState.setError,
    setIsLoading: sessionState.setIsLoading,
  })

  const conversationActions = useChatConversationActions({
    activeConversationId,
    activeWorkspacePath,
    addFolder: sessionState.addFolder,
    applyConversation: sessionState.applyConversation,
    beginEditingMessage: startComposerEditingMessage,
    clearConversationSelection: sessionState.clearConversationSelection,
    clearError: sessionState.clearError,
    conversationRuntimeStatesRef: streamingState.conversationRuntimeStatesRef,
    getDeletionContext: sessionState.getDeletionContext,
    reorderFolder: sessionState.reorderFolder,
    removeFolder: sessionState.removeFolder,
    removeConversationRuntime: sessionState.removeConversationRuntime,
    renameFolder: sessionState.renameFolder,
    replaceConversationSummaries: sessionState.replaceConversationSummaries,
    resetComposerState: composerState.resetComposerState,
    selectedFolderId: sessionState.selectedFolderId,
    resolveFolderIdForWorkspacePath: sessionState.resolveFolderIdForWorkspacePath,
    setError: sessionState.setError,
    upsertConversation: sessionState.upsertConversation,
  })

  useEffect(() => {
    const activeConversationId = sessionState.activeConversationId
    if (!activeConversationId) {
      syncedConversationModeIdRef.current = null
      return
    }

    if (syncedConversationModeIdRef.current === activeConversationId) {
      return
    }

    syncedConversationModeIdRef.current = activeConversationId
    const savedPreference = conversationModelPreferences[activeConversationId]
    if (savedPreference?.chatMode) {
      setDraftChatMode(savedPreference.chatMode)
      return
    }
    const draftModeForConversation = draftChatModeByConversationRef.current[activeConversationId]
    if (draftModeForConversation) {
      setDraftChatMode(draftModeForConversation)
      return
    }

    const activeConversationChatMode = sessionState.activeConversationChatMode
    if (!activeConversationChatMode) {
      return
    }

    setDraftChatMode(activeConversationChatMode)
  }, [conversationModelPreferences, sessionState.activeConversationChatMode, sessionState.activeConversationId])

  useEffect(() => {
    if (!activeConversationId) {
      return
    }

    draftChatModeByConversationRef.current[activeConversationId] = draftChatMode
  }, [activeConversationId, draftChatMode])

  const setSelectedChatMode = useCallback(
    (nextMode: ChatMode) => {
      setDraftChatMode(nextMode)
      if (activeConversationId) {
        draftChatModeByConversationRef.current[activeConversationId] = nextMode
        const existing = conversationModelPreferences[activeConversationId]
        if (existing) {
          onPersistConversationModelPreferences({
            ...conversationModelPreferences,
            [activeConversationId]: { ...existing, chatMode: nextMode },
          })
        }
      }
    },
    [activeConversationId, conversationModelPreferences, onPersistConversationModelPreferences],
  )

  const captureActiveEditDraftSession = useCallback(() => {
    if (!activeConversationId) {
      return
    }

    const activeDraftSession = captureComposerEditingSession()
    if (!activeDraftSession) {
      return
    }

    draftEditSessionsRef.current[activeConversationId] = activeDraftSession
    upsertEditSession(activeConversationId, activeDraftSession.messageId)
  }, [activeConversationId, captureComposerEditingSession, upsertEditSession])

  const clearDraftEditSession = useCallback((conversationId: string) => {
    delete draftEditSessionsRef.current[conversationId]
  }, [])

  const markRevertSessionApplied = useCallback((conversationId: string, revertSession: RevertEditSession) => {
    appliedRevertSessionKeysRef.current[conversationId] = buildRevertSessionKey(conversationId, revertSession)
  }, [])

  const hasAppliedRevertSession = useCallback((conversationId: string, revertSession: RevertEditSession) => {
    return appliedRevertSessionKeysRef.current[conversationId] === buildRevertSessionKey(conversationId, revertSession)
  }, [])

  const beginRevertEditingMessage = useCallback(
    (conversationId: string, messageId: string, redoCheckpointId: string) => {
      clearDraftEditSession(conversationId)
      const currentValue = revertEditSessionsRef.current
      const nextSession: RevertEditSession = {
        messageId,
        redoCheckpointId,
      }
      const existingSession = currentValue[conversationId]
      if (
        !existingSession ||
        existingSession.messageId !== messageId ||
        existingSession.redoCheckpointId !== redoCheckpointId
      ) {
        setRevertEditSessions({
          ...currentValue,
          [conversationId]: nextSession,
        })
      }

      markRevertSessionApplied(conversationId, nextSession)
      upsertEditSession(conversationId, messageId)
      startComposerEditingMessage(messageId)
    },
    [clearDraftEditSession, markRevertSessionApplied, setRevertEditSessions, startComposerEditingMessage, upsertEditSession],
  )

  const completeEditingMessage = useCallback(() => {
    cancelComposerEditingMessage()
    if (activeConversationId) {
      clearDraftEditSession(activeConversationId)
      clearEditSession(activeConversationId)
      clearRevertEditSession(activeConversationId)
    }
  }, [activeConversationId, cancelComposerEditingMessage, clearDraftEditSession, clearEditSession, clearRevertEditSession])

  const redoRevertSession = useCallback(
    async (_conversationId: string, revertSession: RevertEditSession, failureMessage: string) => {
      await window.tidecodeWorkspace.restoreCheckpoint(revertSession.redoCheckpointId).catch((caughtError) => {
        console.error(caughtError)
        throw new Error(failureMessage)
      })
    },
    [],
  )

  const cancelEditingMessage = useCallback(async () => {
    const activeEditingMessageId = editingMessageId
    cancelComposerEditingMessage()

    if (!activeConversationId || !activeEditingMessageId) {
      return
    }

    clearDraftEditSession(activeConversationId)
    clearEditSession(activeConversationId)
    const revertSession = revertEditSessionsRef.current[activeConversationId]
    if (!revertSession || revertSession.messageId !== activeEditingMessageId) {
      return
    }

    const shouldRedoRevertSession = hasAppliedRevertSession(activeConversationId, revertSession)
    clearRevertEditSession(activeConversationId)
    if (!shouldRedoRevertSession) {
      return
    }

    try {
      await redoRevertSession(activeConversationId, revertSession, 'Unable to redo reverted workspace changes.')
    } catch (caughtError) {
      setSessionError(
        caughtError instanceof Error && caughtError.message.trim().length > 0
          ? caughtError.message
          : 'Unable to redo reverted workspace changes.',
      )
    }
  }, [
    activeConversationId,
    cancelComposerEditingMessage,
    clearDraftEditSession,
    clearEditSession,
    clearRevertEditSession,
    editingMessageId,
    hasAppliedRevertSession,
    redoRevertSession,
    setSessionError,
  ])

  useEffect(() => {
    if (!activeConversationId) {
      resumeSessionKeyRef.current = null
      return
    }

    const activeEditSession = editSessionsByConversation[activeConversationId]
    if (!activeEditSession) {
      resumeSessionKeyRef.current = null
      return
    }

    if (editingMessageId === activeEditSession.messageId) {
      return
    }

    const activeDraftSession = draftEditSessionsRef.current[activeConversationId]
    const resumeSessionKey = `${activeConversationId}:${activeEditSession.messageId}`
    if (resumeSessionKeyRef.current === resumeSessionKey) {
      return
    }

    resumeSessionKeyRef.current = resumeSessionKey

    const restoreSucceeded = restoreComposerEditingSession(
      activeDraftSession && activeDraftSession.messageId === activeEditSession.messageId
        ? activeDraftSession
        : activeEditSession,
    )

    if (!restoreSucceeded) {
      clearDraftEditSession(activeConversationId)
      clearEditSession(activeConversationId)
      const activeRevertSession = revertEditSessionsRef.current[activeConversationId]
      if (activeRevertSession?.messageId === activeEditSession.messageId) {
        clearRevertEditSession(activeConversationId)
      }
      setSessionError('Unable to resume edit mode for this thread.')
    }
  }, [
    clearDraftEditSession,
    clearEditSession,
    clearRevertEditSession,
    activeConversationId,
    editSessionsByConversation,
    editingMessageId,
    restoreComposerEditingSession,
    setSessionError,
  ])

  const startEditingMessage = useCallback(
    async (messageId: string) => {
      if (activeConversationId) {
        const activeRevertSession = revertEditSessionsRef.current[activeConversationId]
        if (activeRevertSession && hasAppliedRevertSession(activeConversationId, activeRevertSession)) {
          try {
            await redoRevertSession(
              activeConversationId,
              activeRevertSession,
              'Unable to redo reverted workspace changes before editing that message.',
            )
          } catch (caughtError) {
            clearRevertEditSession(activeConversationId)
            setSessionError(
              caughtError instanceof Error && caughtError.message.trim().length > 0
                ? caughtError.message
                : 'Unable to redo reverted workspace changes before editing that message.',
            )
            return
          }

          clearRevertEditSession(activeConversationId)
        } else if (activeRevertSession) {
          clearRevertEditSession(activeConversationId)
        }
      }

      if (activeConversationId) {
        clearDraftEditSession(activeConversationId)
        upsertEditSession(activeConversationId, messageId)
      }
      conversationActions.startEditingMessage(messageId)
    },
    [
      activeConversationId,
      clearDraftEditSession,
      clearRevertEditSession,
      conversationActions,
      hasAppliedRevertSession,
      redoRevertSession,
      setSessionError,
      upsertEditSession,
    ],
  )

  useEffect(() => {
    if (!editingMessageId) {
      return
    }

    const editingMessageExists = messages.some((message) => message.id === editingMessageId && message.role === 'user')
    if (editingMessageExists) {
      return
    }

    cancelComposerEditingMessage()
    if (activeConversationId) {
      clearDraftEditSession(activeConversationId)
      clearEditSession(activeConversationId)
      const activeRevertSession = revertEditSessionsRef.current[activeConversationId]
      if (activeRevertSession?.messageId === editingMessageId) {
        clearRevertEditSession(activeConversationId)
      }
    }
  }, [
    activeConversationId,
    cancelComposerEditingMessage,
    clearDraftEditSession,
    clearEditSession,
    clearRevertEditSession,
    editingMessageId,
    messages,
  ])

  const sendActions = useChatSendActions({
    activeConversationId,
    activeConversationIdRef: streamingState.activeConversationIdRef,
    applyConversation: sessionState.applyConversation,
    appendLocalMessage: sessionState.appendLocalMessage,
    beginRevertEditingMessage,
    cancelEditingMessage,
    clearError: sessionState.clearError,
    clearTextStreamingIdleTimeout: streamingState.clearTextStreamingIdleTimeout,
    completeEditingMessage,
    conversationRuntimeStatesRef: streamingState.conversationRuntimeStatesRef,
    draftChatMode,
    editComposerAttachments: composerState.editComposerAttachments,
    editComposerValue: composerState.editComposerValue,
    editingMessageId,
    mainComposerAttachments: composerState.mainComposerAttachments,
    mainComposerValue: composerState.mainComposerValue,
    markTextStreamingPulse: streamingState.markTextStreamingPulse,
    pendingDraftSendCount,
    removeLocalMessage: sessionState.removeLocalMessage,
    selectedFolderId: sessionState.selectedFolderId,
    selectedFolderIdRef: streamingState.selectedFolderIdRef,
    setError: sessionState.setError,
    setMainComposerAttachments: composerState.setMainComposerAttachments,
    setMainComposerMentionPathMap: composerState.setMainComposerMentionPathMap,
    setMainComposerValue: composerState.setMainComposerValue,
    setPendingDraftSendCount,
    stopTextStreaming: streamingState.stopTextStreaming,
    updateConversationRuntimeState: sessionState.updateConversationRuntimeState,
    updateConversationSummary: sessionState.updateConversationSummary,
    updateLocalMessage: sessionState.updateLocalMessage,
    upsertConversation: sessionState.upsertConversation,
  })

  const isActiveDraftSending = activeConversationId === null && pendingDraftSendCount > 0

  const deleteAbandonedActiveConversation = useCallback(async () => {
    if (pendingDraftSendCount > 0) {
      return
    }

    if (typeof window !== 'undefined' && window.tidecodeHistory?.cleanupDraftAgentContext) {
      await window.tidecodeHistory.cleanupDraftAgentContext().catch(() => undefined)
    }

    const activeConversationState = sessionState.activeConversationState
    if (
      !activeConversationState ||
      activeConversationState.isSending ||
      activeConversationState.activeStreamId !== null ||
      activeConversationState.conversation.messages.length > 0
    ) {
      return
    }

    try {
      const conversation = activeConversationState.conversation
      const { remainingSummaries } = sessionState.getDeletionContext(conversation.id)
      await window.tidecodeHistory.deleteConversation(conversation.id)
      sessionState.removeConversationRuntime(conversation.id)
      sessionState.replaceConversationSummaries(remainingSummaries)
    } catch (caughtError) {
      console.warn('Skipped cleanup for abandoned empty chat.', caughtError)
    }
  }, [pendingDraftSendCount, sessionState])

  const createConversation = useCallback(
    async (folderId?: string | null) => {
      const resolvedFolderId =
        folderId !== undefined
          ? folderId
          : sessionState.selectedFolderId ?? sessionState.resolveFolderIdForWorkspacePath(activeWorkspacePath)

      if (
        sessionState.activeConversationId === null &&
        sessionState.selectedFolderId === (resolvedFolderId ?? null)
      ) {
        return
      }

      captureActiveEditDraftSession()
      await deleteAbandonedActiveConversation()
      const nextFolderId = conversationActions.prepareNewConversation(folderId)
      persistConversationLaunchPreference({
        conversationId: null,
        draftFolderId: nextFolderId ?? null,
        openEmptyConversationOnLaunch: true,
      })
    },
    [
      activeWorkspacePath,
      captureActiveEditDraftSession,
      conversationActions,
      deleteAbandonedActiveConversation,
      persistConversationLaunchPreference,
      sessionState,
    ],
  )

  const createFolder = useCallback(async () => {
    captureActiveEditDraftSession()
    await deleteAbandonedActiveConversation()
    const createdFolderId = await conversationActions.createFolder()
    if (createdFolderId === undefined) {
      return
    }

    persistConversationLaunchPreference({
      conversationId: null,
      draftFolderId: createdFolderId,
      openEmptyConversationOnLaunch: true,
    })
  }, [captureActiveEditDraftSession, conversationActions, deleteAbandonedActiveConversation, persistConversationLaunchPreference])

  const selectConversation = useCallback(
    async (conversationId: string) => {
      captureActiveEditDraftSession()
      await deleteAbandonedActiveConversation()
      persistConversationLaunchPreference({
        conversationId,
        draftFolderId: null,
        openEmptyConversationOnLaunch: false,
      })
      await conversationActions.selectConversation(conversationId)
    },
    [captureActiveEditDraftSession, conversationActions, deleteAbandonedActiveConversation, persistConversationLaunchPreference],
  )

  const createWorkspaceFolderFromPath = useCallback(
    async (folderPath: string) => {
      captureActiveEditDraftSession()
      await deleteAbandonedActiveConversation()
      const createdFolderId = await conversationActions.createWorkspaceFolderFromPath(folderPath)
      if (createdFolderId === undefined) {
        return
      }

      persistConversationLaunchPreference({
        conversationId: null,
        draftFolderId: createdFolderId,
        openEmptyConversationOnLaunch: true,
      })
    },
    [
      captureActiveEditDraftSession,
      conversationActions,
      deleteAbandonedActiveConversation,
      persistConversationLaunchPreference,
    ],
  )

  const selectFolder = useCallback(
    async (folderId: string | null) => {
      captureActiveEditDraftSession()
      await deleteAbandonedActiveConversation()
      const resolvedFolderId = await conversationActions.selectFolder(folderId)
      persistConversationLaunchPreference({
        conversationId: null,
        draftFolderId: resolvedFolderId,
        openEmptyConversationOnLaunch: true,
      })
    },
    [captureActiveEditDraftSession, conversationActions, deleteAbandonedActiveConversation, persistConversationLaunchPreference],
  )

  return {
    activeConversationId,
    activeConversationRootPath: activeWorkspacePath,
    activeConversationTitle: sessionState.activeConversationTitle,
    cancelEditingMessage,
    conversationGroups: sessionState.conversationGroups,
    createConversation,
    createFolder,
    createWorkspaceFolderFromPath,
    reorderFolder: conversationActions.reorderFolder,
    deleteFolder: conversationActions.deleteFolder,
    archiveConversation: conversationActions.archiveConversation,
    deleteConversation: conversationActions.deleteConversation,
    editComposerAttachments: composerState.editComposerAttachments,
    editComposerFocusSignal: composerState.editComposerFocusSignal,
    editComposerMentionPathMap: composerState.editComposerMentionPathMap,
    editComposerValue: composerState.editComposerValue,
    editingMessageId,
    error: sessionState.error,
    isEditingMessage: editingMessageId !== null,
    isEditComposerDirty: composerState.isEditComposerDirty,
    isLoading: sessionState.isLoading,
    isSending: sessionState.activeConversationState?.isSending ?? isActiveDraftSending,
    isStreamingResponse: sessionState.activeConversationState?.isSending ?? isActiveDraftSending,
    isStreamingTextActive: sessionState.activeConversationState?.isStreamingTextActive ?? false,
    mainComposerAttachments: composerState.mainComposerAttachments,
    mainComposerMentionPathMap: composerState.mainComposerMentionPathMap,
    mainComposerValue: composerState.mainComposerValue,
    messages,
    selectedChatMode: draftChatMode,
    selectedFolderId: sessionState.selectedFolderId,
    selectedFolderName: sessionState.selectedFolderName,
    selectedFolderPath: sessionState.selectedFolderPath,
    selectConversation,
    selectFolder,
    renameConversationTitle: conversationActions.renameConversationTitle,
    pinConversation: conversationActions.pinConversation,
    renameFolder: conversationActions.renameFolder,
    setError: sessionState.setError,
    setEditComposerAttachments: composerState.setEditComposerAttachments,
    setEditComposerValue: composerState.setEditComposerValue,
    setMainComposerAttachments: composerState.setMainComposerAttachments,
    setMainComposerMentionPathMap: composerState.setMainComposerMentionPathMap,
    setMainComposerValue: composerState.setMainComposerValue,
    setSelectedChatMode,
    startEditingMessage,
    streamingAssistantMessageId: sessionState.activeConversationState?.streamingAssistantMessageId ?? null,
    streamingWaitingIndicatorVariant: sessionState.activeConversationState?.streamingWaitingIndicatorVariant ?? null,
    abortStreamingResponse: sendActions.abortStreamingResponse,
    revertUserMessage: sendActions.revertUserMessage,
    sendEditedMessage: sendActions.sendEditedMessage,
    sendNewMessage: sendActions.sendNewMessage,
    sendProgrammaticMessage: sendActions.sendProgrammaticMessage,
  }
}

export type ChatMessagesController = ReturnType<typeof useChatMessages>
export type { ChatRuntimeSelection }
