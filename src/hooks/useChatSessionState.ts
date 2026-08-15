import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AssistantWaitingIndicatorVariant,
  ChatMode,
  ConversationFolderSummary,
  ConversationRecord,
  ReorderConversationFolderInput,
  ConversationSummary,
  Message,
  SharedRunProjection,
  SharedRunSnapshot,
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
  sharedRunId: string | null
  isStreamingTextActive: boolean
  streamingAssistantMessageId: string | null
  streamingWaitingIndicatorVariant: AssistantWaitingIndicatorVariant | null
}

type ConversationRuntimeStateMap = Record<string, ConversationRuntimeState>

interface UpdateConversationRuntimeInput {
  activeStreamId?: string | null
  isSending?: boolean
  sharedRunId?: string | null
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
    sharedRunId: currentValue?.sharedRunId ?? null,
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

function applySharedRunProjection(
  conversation: ConversationRecord,
  projection: SharedRunProjection,
): ConversationRecord {
  return {
    ...conversation,
    messages: [
      ...conversation.messages.slice(0, projection.baseMessageCount),
      ...projection.messages,
    ],
  }
}

function attachSharedRunToRuntimeState(
  runtimeState: ConversationRuntimeState,
  run: SharedRunSnapshot,
  projection?: SharedRunProjection,
): ConversationRuntimeState {
  return {
    ...runtimeState,
    activeStreamId: run.streamId,
    conversation: projection
      ? applySharedRunProjection(runtimeState.conversation, projection)
      : runtimeState.conversation,
    isSending: true,
    sharedRunId: run.runId,
    isStreamingTextActive: projection?.isStreamingTextActive ?? runtimeState.isStreamingTextActive,
    streamingAssistantMessageId:
      projection?.streamingAssistantMessageId ?? runtimeState.streamingAssistantMessageId,
    streamingWaitingIndicatorVariant:
      projection?.streamingWaitingIndicatorVariant ?? runtimeState.streamingWaitingIndicatorVariant,
  }
}

export function useChatSessionState(language: AppLanguage) {
  const [conversationSummaries, setConversationSummaries] = useState<ConversationSummary[]>([])
  const [folderSummaries, setFolderSummaries] = useState<ConversationFolderSummary[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [activeConversationChatMode, setActiveConversationChatMode] = useState<ChatMode | null>(null)
  const [conversationRuntimeStates, setConversationRuntimeStates] = useState<ConversationRuntimeStateMap>({})
  const sharedRunsByConversationIdRef = useRef(new Map<string, SharedRunSnapshot>())
  const sharedRunProjectionsByConversationIdRef = useRef(new Map<string, SharedRunProjection>())
  const [sharedRunningConversationIds, setSharedRunningConversationIds] = useState<Set<string>>(() => new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const activeConversationState = activeConversationId ? conversationRuntimeStates[activeConversationId] ?? null : null
  const runningConversationIds = useMemo(() => {
    const runningIds = new Set(sharedRunningConversationIds)
    for (const conversationState of Object.values(conversationRuntimeStates)) {
      if (conversationState.isSending || conversationState.activeStreamId !== null) {
        runningIds.add(conversationState.conversation.id)
      }
    }
    return runningIds
  }, [conversationRuntimeStates, sharedRunningConversationIds])

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
    setConversationRuntimeStates((currentValue) => {
      const currentState = currentValue[conversation.id]
      const nextState = createConversationRuntimeState(conversation, currentState)
      const sharedRun = sharedRunsByConversationIdRef.current.get(conversation.id)
      const projection = sharedRunProjectionsByConversationIdRef.current.get(conversation.id)
      const shouldAttachSharedRun = sharedRun
        && (!currentState || (!currentState.isSending && currentState.activeStreamId === null) || currentState.sharedRunId === sharedRun.runId)
      return {
        ...currentValue,
        [conversation.id]: shouldAttachSharedRun
          ? attachSharedRunToRuntimeState(nextState, sharedRun, projection)
          : nextState,
      }
    })
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

      setConversationRuntimeStates((currentValue) => {
        const currentState = currentValue[initialConversation.id]
        const nextState = createConversationRuntimeState(initialConversation, currentState)
        const sharedRun = sharedRunsByConversationIdRef.current.get(initialConversation.id)
        const projection = sharedRunProjectionsByConversationIdRef.current.get(initialConversation.id)
        const shouldAttachSharedRun = sharedRun
          && (!currentState || (!currentState.isSending && currentState.activeStreamId === null) || currentState.sharedRunId === sharedRun.runId)
        return {
          ...currentValue,
          [initialConversation.id]: shouldAttachSharedRun
            ? attachSharedRunToRuntimeState(nextState, sharedRun, projection)
            : nextState,
        }
      })
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

  useEffect(() => {
    let disposed = false

    const applyProjection = (projection: SharedRunProjection) => {
      if (disposed) return
      const sharedRun = sharedRunsByConversationIdRef.current.get(projection.conversationId)
      if (!sharedRun || sharedRun.runId !== projection.runId) return
      sharedRunProjectionsByConversationIdRef.current.set(projection.conversationId, projection)
      setConversationRuntimeStates((currentValue) => {
        const currentState = currentValue[projection.conversationId]
        if (!currentState) return currentValue
        const isLocallyOwnedRuntime = currentState.sharedRunId === null
          && (currentState.isSending || currentState.activeStreamId !== null)
        if (isLocallyOwnedRuntime) return currentValue
        return {
          ...currentValue,
          [projection.conversationId]: attachSharedRunToRuntimeState(currentState, sharedRun, projection),
        }
      })
    }

    const loadProjection = (run: SharedRunSnapshot) => {
      const existingProjection = sharedRunProjectionsByConversationIdRef.current.get(run.conversationId)
      if (existingProjection?.runId === run.runId) return
      void window.tidecodeRuns.getRunProjection(run.runId)
        .then((projection) => {
          if (projection) applyProjection(projection)
        })
        .catch((caughtError) => console.error('Unable to load shared Tidecode run projection.', caughtError))
    }

    const reconcileSharedRuns = (runs: SharedRunSnapshot[]) => {
      if (disposed) return
      const runsByConversationId = new Map(runs.map((run) => [run.conversationId, run]))
      sharedRunsByConversationIdRef.current = runsByConversationId
      for (const [conversationId, projection] of sharedRunProjectionsByConversationIdRef.current.entries()) {
        const run = runsByConversationId.get(conversationId)
        if (!run || run.runId !== projection.runId) {
          sharedRunProjectionsByConversationIdRef.current.delete(conversationId)
        }
      }
      setSharedRunningConversationIds(new Set(runsByConversationId.keys()))
      setConversationRuntimeStates((currentValue) => {
        let hasChanges = false
        const nextValue = { ...currentValue }

        for (const [conversationId, currentState] of Object.entries(currentValue)) {
          const sharedRun = runsByConversationId.get(conversationId)
          if (currentState.sharedRunId) {
            if (!sharedRun || sharedRun.runId !== currentState.sharedRunId) {
              nextValue[conversationId] = {
                ...currentState,
                activeStreamId: null,
                isSending: false,
                sharedRunId: null,
                isStreamingTextActive: false,
                streamingAssistantMessageId: null,
                streamingWaitingIndicatorVariant: null,
              }
              hasChanges = true
              continue
            }

            const projection = sharedRunProjectionsByConversationIdRef.current.get(conversationId)
            nextValue[conversationId] = attachSharedRunToRuntimeState(currentState, sharedRun, projection)
            hasChanges = true
            continue
          }

          if (sharedRun && !currentState.isSending && currentState.activeStreamId === null) {
            const projection = sharedRunProjectionsByConversationIdRef.current.get(conversationId)
            nextValue[conversationId] = attachSharedRunToRuntimeState(currentState, sharedRun, projection)
            hasChanges = true
          }
        }

        return hasChanges ? nextValue : currentValue
      })
      for (const run of runs) loadProjection(run)
    }

    const refreshSharedRuns = () => {
      void window.tidecodeRuns.listActiveRuns()
        .then(reconcileSharedRuns)
        .catch((caughtError) => console.error('Unable to load shared Tidecode runs.', caughtError))
    }

    refreshSharedRuns()
    const reconciliationIntervalId = window.setInterval(refreshSharedRuns, 2_000)

    const unsubscribe = window.tidecodeRuns.onEvent((event) => {
      if (event.type === 'run_state') {
        const isRunning = event.run.status === 'starting'
          || event.run.status === 'running'
          || event.run.status === 'waiting_for_input'
        if (isRunning) {
          sharedRunsByConversationIdRef.current.set(event.run.conversationId, event.run)
          loadProjection(event.run)
        } else {
          sharedRunsByConversationIdRef.current.delete(event.run.conversationId)
          const projection = sharedRunProjectionsByConversationIdRef.current.get(event.run.conversationId)
          if (projection?.runId === event.run.runId) {
            sharedRunProjectionsByConversationIdRef.current.delete(event.run.conversationId)
          }
        }
        setSharedRunningConversationIds((currentValue) => {
          const nextValue = new Set(currentValue)
          if (isRunning) nextValue.add(event.run.conversationId)
          else nextValue.delete(event.run.conversationId)
          return nextValue
        })
        setConversationRuntimeStates((currentValue) => {
          const currentState = currentValue[event.run.conversationId]
          if (!currentState) return currentValue

          if (isRunning) {
            const isLocallyOwnedRuntime = currentState.sharedRunId === null
              && (currentState.isSending || currentState.activeStreamId !== null)
            if (isLocallyOwnedRuntime) return currentValue
            return {
              ...currentValue,
              [event.run.conversationId]: {
                ...currentState,
                activeStreamId: event.run.streamId,
                isSending: true,
                sharedRunId: event.run.runId,
              },
            }
          }

          if (currentState.sharedRunId !== event.run.runId) return currentValue
          return {
            ...currentValue,
            [event.run.conversationId]: {
              ...currentState,
              activeStreamId: null,
              isSending: false,
              sharedRunId: null,
              isStreamingTextActive: false,
              streamingAssistantMessageId: null,
              streamingWaitingIndicatorVariant: null,
            },
          }
        })
        return
      }

      if (event.type === 'run_projection') {
        applyProjection(event.projection)
        return
      }

      if (event.type === 'conversation_replaced') {
        const conversation = event.conversation
        sharedRunProjectionsByConversationIdRef.current.delete(conversation.id)
        sharedRunsByConversationIdRef.current.delete(conversation.id)
        setSharedRunningConversationIds((currentValue) => {
          if (!currentValue.has(conversation.id)) return currentValue
          const nextValue = new Set(currentValue)
          nextValue.delete(conversation.id)
          return nextValue
        })
        setConversationSummaries((currentValue) => upsertConversationSummary(currentValue, conversation))
        setConversationRuntimeStates((currentValue) => {
          const currentState = currentValue[conversation.id]
          if (!currentState) return currentValue
          return {
            ...currentValue,
            [conversation.id]: {
              ...createConversationRuntimeState(conversation, currentState),
              activeStreamId: null,
              isSending: false,
              sharedRunId: null,
              isStreamingTextActive: false,
              streamingAssistantMessageId: null,
              streamingWaitingIndicatorVariant: null,
            },
          }
        })
        return
      }

      if (event.type !== 'conversation_updated') return
      const conversation = event.conversation
      setConversationSummaries((currentValue) => upsertConversationSummary(currentValue, conversation))
      setConversationRuntimeStates((currentValue) => {
        const currentState = currentValue[conversation.id]
        if (!currentState) return currentValue
        if (currentState.activeStreamId !== null && currentState.sharedRunId !== event.runId) {
          return currentValue
        }
        const projection = sharedRunProjectionsByConversationIdRef.current.get(conversation.id)
        const nextConversation = currentState.sharedRunId === event.runId && projection?.runId === event.runId
          ? applySharedRunProjection(conversation, projection)
          : conversation
        return {
          ...currentValue,
          [conversation.id]: createConversationRuntimeState(nextConversation, currentState),
        }
      })
    })

    return () => {
      disposed = true
      window.clearInterval(reconciliationIntervalId)
      unsubscribe()
    }
  }, [])

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
            ...(input.sharedRunId !== undefined ? { sharedRunId: input.sharedRunId } : {}),
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
