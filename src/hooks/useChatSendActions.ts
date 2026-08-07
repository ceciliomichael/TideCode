import { useCallback, useRef } from 'react'
import { toUserFacingErrorMessage } from '../lib/userFacingError'
import {
  getMessagesThroughUserMessage,
  prepareRevertSessionForMessage,
  persistConversationSnapshot,
  rollbackConversationBeforeUserMessage,
  restoreWorkspaceCheckpointForMessage,
  restoreWorkspaceCheckpointSequence,
} from './chatHistoryWorkflows'
import { persistAndStreamMessage } from './chatMessageSendWorkflow'
import type { ChatRuntimeSelection } from './chatMessageRuntime'
import type { PersistAndStreamMessageInput, PersistedUserTurn } from './chatMessageSendTypes'
import { restoreChatComposerDraft } from '../lib/chatComposerDraft'
import { readChatSelectionFromRefs } from '../lib/chatSelection'
import {
  acquireChatSendScopeGate,
  getChatSendScopeKey,
  isChatSendBlocked,
  releaseChatSendScopeGate,
} from '../lib/chatSendGate'
import {
  getActiveUnrespondedUserMessage,
  getPendingRevertMessageIds,
  isActiveUnrespondedUserMessage,
} from './chatPendingMessageRevert'
import type { ChatMode, Message } from '../types/chat'

const RUN_STATE_SETTLE_TIMEOUT_MS = 20_000
const STREAM_REGISTRATION_POLL_TIMEOUT_MS = 8_000

interface UseChatSendActionsInput
  extends Omit<
    PersistAndStreamMessageInput,
    | 'runtimeSelection'
    | 'targetEditMessageId'
    | 'trimmedText'
    | 'originalText'
    | 'attachments'
    | 'hasPendingAbortRequest'
    | 'consumePendingAbortBeforeStreamStart'
  > {
  beginRevertEditingMessage: (conversationId: string, messageId: string, redoCheckpointId: string) => void
  cancelEditingMessage: () => void
  editComposerAttachments: PersistAndStreamMessageInput['attachments']
  editComposerValue: string
  editingMessageId: string | null
  mainComposerAttachments: PersistAndStreamMessageInput['attachments']
  mainComposerValue: string
  pendingDraftSendCount: number
}

interface SendNewMessageOptions {
  resetMainComposerAfterSend?: boolean
  waitForConversationToSettle?: boolean
}

interface ChatSendAttemptResult {
  accepted: boolean
  retryable: boolean
}

interface SendProgrammaticMessageOptions {
  chatMode?: ChatMode
  compactionSourceConversationId?: string
  forceNewConversation?: boolean
  syntheticAssistantMessage?: PersistAndStreamMessageInput['syntheticAssistantMessage']
  title?: string
}

type ConversationStateSnapshot =
  | PersistAndStreamMessageInput['conversationRuntimeStatesRef']['current'][string]
  | null

function isMissingCheckpointError(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes('workspace checkpoint')
}

function isMessageNotFoundError(error: unknown) {
  return error instanceof Error && /^message not found:/i.test(error.message.trim())
}

function toActionErrorMessage(error: unknown, fallbackMessage: string) {
  return toUserFacingErrorMessage(error, fallbackMessage)
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds)
  })
}

export function useChatSendActions(input: UseChatSendActionsInput) {
  const actionInFlightRef = useRef(false)
  const abortOperationRef = useRef<Promise<void> | null>(null)
  const submissionInFlightRef = useRef<Set<string>>(new Set())
  const pendingAbortBeforeStreamStartRef = useRef(false)
  const revertedUserMessageIdsRef = useRef<Set<string>>(new Set())
  const pendingPersistedUserTurnsRef = useRef<Map<string, PersistedUserTurn>>(new Map())

  const isUserMessageReverted = useCallback((messageId: string) => {
    return revertedUserMessageIdsRef.current.has(messageId)
  }, [])

  const clearUserMessageRevert = useCallback((messageId: string) => {
    revertedUserMessageIdsRef.current.delete(messageId)
  }, [])

  const registerPersistedUserTurn = useCallback((turn: PersistedUserTurn) => {
    pendingPersistedUserTurnsRef.current.set(turn.conversationId, turn)
  }, [])

  const clearPersistedUserTurn = useCallback((turn: PersistedUserTurn) => {
    const currentTurn = pendingPersistedUserTurnsRef.current.get(turn.conversationId)
    if (currentTurn?.message.id === turn.message.id) {
      pendingPersistedUserTurnsRef.current.delete(turn.conversationId)
    }
  }, [])

  const restoreUserMessageDraftToMainComposer = useCallback(
    (message: Message | null) => {
      if (!message || message.role !== 'user') {
        return false
      }

      const restoredComposerDraft = restoreChatComposerDraft(message.content)
      input.setMainComposerValue(restoredComposerDraft.value)
      input.setMainComposerAttachments(message.attachments ?? [])
      input.setMainComposerMentionPathMap(restoredComposerDraft.mentionPathMap)
      return true
    },
    [input],
  )

  const restorePendingUserMessageToMainComposer = useCallback(
    (conversationId: string, message: Message | null, options?: { restoreComposer?: boolean }) => {
      if (!message || message.role !== 'user') {
        return false
      }

      revertedUserMessageIdsRef.current.add(message.id)
      input.cancelEditingMessage()
      if (options?.restoreComposer !== false) {
        restoreUserMessageDraftToMainComposer(message)
      }

      const conversationState = input.conversationRuntimeStatesRef.current[conversationId] ?? null
      const pendingMessageIds = getPendingRevertMessageIds(conversationState, message.id)
      for (const messageId of pendingMessageIds.length > 0 ? pendingMessageIds : [message.id]) {
        input.removeLocalMessage(conversationId, messageId)
      }

      input.updateConversationRuntimeState(conversationId, {
        isStreamingTextActive: false,
        streamingAssistantMessageId: null,
        streamingWaitingIndicatorVariant: null,
      })
      return true
    },
    [input, restoreUserMessageDraftToMainComposer],
  )

  const getConversationState = useCallback(
    (conversationId: string) => input.conversationRuntimeStatesRef.current[conversationId] ?? null,
    [input.conversationRuntimeStatesRef],
  )

  const resolvePendingStopTurn = useCallback(
    (conversationId: string | null) => {
      if (conversationId) {
        const conversationState = getConversationState(conversationId)
        const pendingUserMessage = getActiveUnrespondedUserMessage(conversationState)
        if (pendingUserMessage) {
          return {
            conversationId,
            message: pendingUserMessage,
          } satisfies PersistedUserTurn
        }
      }

      const trackedTurn = conversationId
        ? pendingPersistedUserTurnsRef.current.get(conversationId)
        : Array.from(pendingPersistedUserTurnsRef.current.values()).at(-1)
      if (!trackedTurn) {
        return null
      }

      const conversationState = getConversationState(trackedTurn.conversationId)
      if (conversationState && !isActiveUnrespondedUserMessage(conversationState, trackedTurn.message.id)) {
        return null
      }

      return trackedTurn
    },
    [getConversationState],
  )

  const rollbackPendingUserMessage = useCallback(
    async (turn: PersistedUserTurn) => {
      const rolledBackConversation = await rollbackConversationBeforeUserMessage(turn.conversationId, turn.message.id)
      input.upsertConversation(rolledBackConversation)
      input.updateConversationSummary(rolledBackConversation)

      const activeConversationId = readChatSelectionFromRefs(input).activeConversationId
      if (activeConversationId === turn.conversationId) {
        input.applyConversation(rolledBackConversation)
        restoreUserMessageDraftToMainComposer(turn.message)
      } else if (activeConversationId === null) {
        restoreUserMessageDraftToMainComposer(turn.message)
      }
    },
    [input, restoreUserMessageDraftToMainComposer],
  )

  const findActiveRunConversationId = useCallback(() => {
    const activeConversationId = readChatSelectionFromRefs(input).activeConversationId
    if (activeConversationId) {
      return activeConversationId
    }

    const activeEntry = Object.values(input.conversationRuntimeStatesRef.current).find(
      (conversationState) => conversationState.isSending || conversationState.activeStreamId !== null,
    )

    return activeEntry?.conversation.id ?? null
  }, [input])

  const waitForConversationRunState = useCallback(
    async (
      conversationId: string,
      predicate: (conversationState: ConversationStateSnapshot) => boolean,
      timeoutMs = RUN_STATE_SETTLE_TIMEOUT_MS,
    ) => {
      const startedAt = Date.now()

      while (Date.now() - startedAt < timeoutMs) {
        const conversationState = getConversationState(conversationId)
        if (predicate(conversationState)) {
          return conversationState
        }

        await sleep(25)
      }

      throw new Error('Timed out while waiting for the current run state to settle.')
    },
    [getConversationState],
  )

  const waitForAbortableConversationId = useCallback(
    async (options?: { preservePendingAbortForSubmission?: boolean }) => {
      const preservePendingAbortForSubmission = options?.preservePendingAbortForSubmission === true
      const immediateConversationId = findActiveRunConversationId()
      if (immediateConversationId) {
        const immediateState = getConversationState(immediateConversationId)
        if (
          !preservePendingAbortForSubmission ||
          immediateState?.isSending === true ||
          Boolean(immediateState?.activeStreamId) ||
          submissionInFlightRef.current.size === 0
        ) {
          return immediateConversationId
        }
      }

      const startedAt = Date.now()
      while (Date.now() - startedAt < 4_000) {
        const conversationId = findActiveRunConversationId()
        if (conversationId) {
          const conversationState = getConversationState(conversationId)
          if (
            !preservePendingAbortForSubmission ||
            conversationState?.isSending === true ||
            Boolean(conversationState?.activeStreamId) ||
            submissionInFlightRef.current.size === 0
          ) {
            return conversationId
          }
        }

        await sleep(25)
      }

      return null
    },
    [findActiveRunConversationId, getConversationState],
  )

  const waitForSendReadiness = useCallback(
    async (conversationId: string | null, sendScopeKey: string) => {
      const startedAt = Date.now()

      while (Date.now() - startedAt < RUN_STATE_SETTLE_TIMEOUT_MS) {
        const isActiveConversationSending = conversationId
          ? (getConversationState(conversationId)?.isSending ?? false)
          : false
        const hasPendingDraftSend = conversationId === null && input.pendingDraftSendCount > 0

        if (!isChatSendBlocked({
          actionInFlight: actionInFlightRef.current,
          hasPendingDraftSend,
          hasSubmissionInFlight: submissionInFlightRef.current.has(sendScopeKey),
          isConversationSending: isActiveConversationSending,
        })) {
          return true
        }

        await sleep(25)
      }

      return false
    },
    [getConversationState, input],
  )

  const abortActiveStreamIfNeeded = useCallback(
    async (options?: { requestAbortBeforeStreamStart?: boolean }) => {
      if (options?.requestAbortBeforeStreamStart) {
        pendingAbortBeforeStreamStartRef.current = true
      }

      const existingAbortOperation = abortOperationRef.current
      if (existingAbortOperation) {
        await existingAbortOperation
        return
      }

      const abortOperation = (async () => {
        const conversationId = await waitForAbortableConversationId({
          preservePendingAbortForSubmission: options?.requestAbortBeforeStreamStart,
        })
        if (!conversationId) {
          if (options?.requestAbortBeforeStreamStart && submissionInFlightRef.current.size === 0) {
            pendingAbortBeforeStreamStartRef.current = false
          }
          return
        }

        let conversationState = getConversationState(conversationId)
        if (!conversationState) {
          return
        }

        if (!conversationState.isSending && conversationState.activeStreamId === null) {
          // A stop click can arrive just after the runtime has already
          // settled. Do not let that stale click cancel the user's next send.
          if (options?.requestAbortBeforeStreamStart && submissionInFlightRef.current.size === 0) {
            pendingAbortBeforeStreamStartRef.current = false
          }
          return
        }

        if (!conversationState.activeStreamId && conversationState.isSending) {
          if (options?.requestAbortBeforeStreamStart) {
            // The send workflow owns the pre-stream abort flag, so a stop
            // click in the pre-stream window (before the stream id is
            // registered) must not race the rollback. Wait for the stream id
            // to appear and cancel it immediately: otherwise the run keeps
            // streaming (and executing tools) in the background and persists
            // the reverted user turn back to history.
            const registrationPollStartedAt = Date.now()
            while (Date.now() - registrationPollStartedAt < STREAM_REGISTRATION_POLL_TIMEOUT_MS) {
              const currentState = getConversationState(conversationId)
              const registeredStreamId = currentState?.activeStreamId ?? null
              if (registeredStreamId) {
                await window.tidecodeChat.cancelStream(registeredStreamId)
                break
              }
              if (!currentState?.isSending) {
                break
              }
              await sleep(25)
            }

            // Wait for the send workflow's finally block so stop -> revert
            // cannot race the rollback.
            await waitForConversationRunState(
              conversationId,
              (currentValue) => currentValue?.isSending !== true && currentValue?.activeStreamId === null,
            )
            return
          }

          conversationState = await waitForConversationRunState(
            conversationId,
            (currentValue) => !currentValue?.isSending || currentValue.activeStreamId !== null,
          )
        }

        const streamId = conversationState.activeStreamId ?? null
        if (streamId) {
          await window.tidecodeChat.cancelStream(streamId)
        }

        await waitForConversationRunState(
          conversationId,
          (currentValue) => currentValue?.isSending !== true && currentValue?.activeStreamId === null,
        )
      })()

      abortOperationRef.current = abortOperation
      try {
        await abortOperation
      } finally {
        if (abortOperationRef.current === abortOperation) {
          abortOperationRef.current = null
        }
      }
    },
    [getConversationState, waitForAbortableConversationId, waitForConversationRunState],
  )

  const sendNewMessage = useCallback(
    async (
      runtimeSelection: ChatRuntimeSelection,
      messageText?: string,
      attachments = input.mainComposerAttachments,
      options?: SendNewMessageOptions,
    ): Promise<ChatSendAttemptResult> => {
      const selection = readChatSelectionFromRefs(input)
      const activeConversationId = selection.activeConversationId
      const sendScopeKey = getChatSendScopeKey(activeConversationId)
      const isActiveConversationSending = activeConversationId
        ? (getConversationState(activeConversationId)?.isSending ?? false)
        : false

      if (
        options?.waitForConversationToSettle &&
        isChatSendBlocked({
          actionInFlight: actionInFlightRef.current,
          hasPendingDraftSend: activeConversationId === null && input.pendingDraftSendCount > 0,
          hasSubmissionInFlight: submissionInFlightRef.current.has(sendScopeKey),
          isConversationSending: isActiveConversationSending,
        })
      ) {
        const isReady = await waitForSendReadiness(activeConversationId, sendScopeKey)
        if (!isReady) {
          return { accepted: false, retryable: false }
        }
      }

      const isSendingAfterWait = activeConversationId
        ? (getConversationState(activeConversationId)?.isSending ?? false)
        : false
      if (
        isChatSendBlocked({
          actionInFlight: actionInFlightRef.current,
          hasPendingDraftSend: activeConversationId === null && input.pendingDraftSendCount > 0,
          hasSubmissionInFlight: submissionInFlightRef.current.has(sendScopeKey),
          isConversationSending: isSendingAfterWait,
        })
      ) {
        return { accepted: false, retryable: true }
      }

      const nextMessageText = messageText ?? input.mainComposerValue
      const trimmedText = nextMessageText.trim()
      if (trimmedText.length === 0 && attachments.length === 0) {
        return { accepted: false, retryable: false }
      }

      if (!acquireChatSendScopeGate(submissionInFlightRef, sendScopeKey)) {
        return { accepted: false, retryable: true }
      }

      pendingAbortBeforeStreamStartRef.current = false

      try {
        const accepted = await persistAndStreamMessage({
          ...input,
          activeConversationId,
          attachments,
          hasPendingAbortRequest: () => pendingAbortBeforeStreamStartRef.current,
          consumePendingAbortBeforeStreamStart: () => {
            if (!pendingAbortBeforeStreamStartRef.current) {
              return false
            }

            pendingAbortBeforeStreamStartRef.current = false
            return true
          },
          onUserTurnPersisted: registerPersistedUserTurn,
          onUserTurnSettled: clearPersistedUserTurn,
          isUserMessageReverted,
          clearUserMessageRevert,
          originalText: nextMessageText,
          resetMainComposerAfterSend: options?.resetMainComposerAfterSend,
          runtimeSelection,
          selectedFolderId: selection.selectedFolderId,
          targetEditMessageId: null,
          trimmedText,
        })
        return {
          accepted,
          retryable: false,
        }
      } finally {
        releaseChatSendScopeGate(submissionInFlightRef, sendScopeKey)
      }
    },
    [
      clearPersistedUserTurn,
      clearUserMessageRevert,
      getConversationState,
      input,
      isUserMessageReverted,
      registerPersistedUserTurn,
      waitForSendReadiness,
    ],
  )

  const sendProgrammaticMessage = useCallback(
    async (
      runtimeSelection: ChatRuntimeSelection,
      messageText: string,
      options?: SendProgrammaticMessageOptions,
    ) => {
      const selection = readChatSelectionFromRefs(input)
      const activeConversationId = options?.forceNewConversation ? null : selection.activeConversationId
      const sendScopeKey = getChatSendScopeKey(activeConversationId)
      const isActiveConversationSending = activeConversationId
        ? (getConversationState(activeConversationId)?.isSending ?? false)
        : false

      if (
        submissionInFlightRef.current.has(sendScopeKey) ||
        actionInFlightRef.current ||
        isActiveConversationSending ||
        (!options?.forceNewConversation && activeConversationId === null && input.pendingDraftSendCount > 0)
      ) {
        return
      }

      const trimmedText = messageText.trim()
      if (trimmedText.length === 0) {
        return
      }

      if (!acquireChatSendScopeGate(submissionInFlightRef, sendScopeKey)) {
        return
      }

      pendingAbortBeforeStreamStartRef.current = false

      try {
        await persistAndStreamMessage({
          ...input,
          attachments: [],
          activeConversationId,
          hasPendingAbortRequest: () => pendingAbortBeforeStreamStartRef.current,
          consumePendingAbortBeforeStreamStart: () => {
            if (!pendingAbortBeforeStreamStartRef.current) {
              return false
            }

            pendingAbortBeforeStreamStartRef.current = false
            return true
          },
          isUserMessageReverted,
          clearUserMessageRevert,
          originalText: messageText,
          draftChatMode: options?.chatMode ?? input.draftChatMode,
          activeConversationIdRef: options?.forceNewConversation ? { current: null } : input.activeConversationIdRef,
          compactionSourceConversationId: options?.compactionSourceConversationId,
          resetMainComposerAfterSend: false,
          runtimeSelection,
          selectedFolderId: selection.selectedFolderId,
          targetEditMessageId: null,
          trimmedText,
          syntheticAssistantMessage: options?.syntheticAssistantMessage,
          title: options?.title,
        })
      } finally {
        releaseChatSendScopeGate(submissionInFlightRef, sendScopeKey)
      }
    },
    [
      clearUserMessageRevert,
      getConversationState,
      input,
      isUserMessageReverted,
    ],
  )

  const sendEditedMessage = useCallback(
    async (
      runtimeSelection: ChatRuntimeSelection,
      messageText?: string,
      attachments = input.editComposerAttachments,
    ) => {
      const conversationId = readChatSelectionFromRefs(input).activeConversationId
      if (
        conversationId === null ||
        submissionInFlightRef.current.has(getChatSendScopeKey(conversationId)) ||
        actionInFlightRef.current ||
        input.editingMessageId === null
      ) {
        return
      }

      const sendScopeKey = getChatSendScopeKey(conversationId)

      const nextMessageText = messageText ?? input.editComposerValue
      const trimmedText = nextMessageText.trim()
      if (trimmedText.length === 0 && attachments.length === 0) {
        return
      }

      if (!acquireChatSendScopeGate(submissionInFlightRef, sendScopeKey)) {
        return
      }

      try {
        let persistedConversation
        try {
          persistedConversation = await window.tidecodeHistory.getConversation(conversationId)
        } catch (caughtError) {
          console.error(caughtError)
          input.cancelEditingMessage()
          input.setError('Unable to reload that conversation right now.')
          return
        }

        const hasPersistedEditableMessage = Boolean(
          persistedConversation?.messages.some(
            (message) => message.id === input.editingMessageId && message.role === 'user',
          ),
        )
        if (!hasPersistedEditableMessage) {
          input.cancelEditingMessage()
          input.setError('This message is no longer available to edit.')
          return
        }

        const conversationState = getConversationState(conversationId)
        const hasEditableMessage = Boolean(
          conversationState?.conversation.messages.some(
            (message) => message.id === input.editingMessageId && message.role === 'user',
          ),
        )
        if (!hasEditableMessage) {
          input.cancelEditingMessage()
          input.setError('This message is no longer available to edit.')
          return
        }

        actionInFlightRef.current = true
        try {
          input.clearError()
          await abortActiveStreamIfNeeded()
          await restoreWorkspaceCheckpointForMessage(conversationId, input.editingMessageId)
        } catch (caughtError) {
          if (isMessageNotFoundError(caughtError)) {
            input.cancelEditingMessage()
            input.setError('This message is no longer available to edit.')
            return
          }

          if (!isMissingCheckpointError(caughtError)) {
            throw caughtError
          }
        } finally {
          actionInFlightRef.current = false
        }

        pendingAbortBeforeStreamStartRef.current = false

        await persistAndStreamMessage({
          ...input,
          attachments,
          activeConversationId: conversationId,
          hasPendingAbortRequest: () => pendingAbortBeforeStreamStartRef.current,
          consumePendingAbortBeforeStreamStart: () => {
            if (!pendingAbortBeforeStreamStartRef.current) {
              return false
            }

            pendingAbortBeforeStreamStartRef.current = false
            return true
          },
          isUserMessageReverted,
          clearUserMessageRevert,
          originalText: nextMessageText,
          runtimeSelection,
          selectedFolderId: readChatSelectionFromRefs(input).selectedFolderId,
          targetEditMessageId: input.editingMessageId,
          trimmedText,
        })
      } catch (caughtError) {
        console.error(caughtError)
        if (isMessageNotFoundError(caughtError)) {
          input.cancelEditingMessage()
          input.setError('This message is no longer available to edit.')
          return
        }

        input.setError(toActionErrorMessage(caughtError, 'Unable to resend your edit.'))
      } finally {
        releaseChatSendScopeGate(submissionInFlightRef, sendScopeKey)
      }
    },
    [
      abortActiveStreamIfNeeded,
      clearUserMessageRevert,
      getConversationState,
      input,
      isUserMessageReverted,
    ],
  )

  const abortStreamingResponse = useCallback(async () => {
    if (actionInFlightRef.current) {
      return
    }

    const conversationId = readChatSelectionFromRefs(input).activeConversationId
    const pendingStopTurn = resolvePendingStopTurn(conversationId)
    if (pendingStopTurn) {
      restorePendingUserMessageToMainComposer(pendingStopTurn.conversationId, pendingStopTurn.message, {
        restoreComposer: false,
      })
    }

    let rollbackError: unknown = null
    const pendingRollbackPromise = pendingStopTurn
      ? rollbackPendingUserMessage(pendingStopTurn).catch((caughtError) => {
          rollbackError = caughtError
        })
      : null
    let stopError: unknown = null
    try {
      await abortActiveStreamIfNeeded({ requestAbortBeforeStreamStart: true })
    } catch (caughtError) {
      stopError = caughtError
      const activeConversationId = readChatSelectionFromRefs(input).activeConversationId
      if (
        pendingStopTurn &&
        (activeConversationId === pendingStopTurn.conversationId || activeConversationId === null)
      ) {
        restoreUserMessageDraftToMainComposer(pendingStopTurn.message)
      }
    }

    if (pendingRollbackPromise) {
      await pendingRollbackPromise
    }
    if (rollbackError) {
      stopError = stopError ?? rollbackError
      console.error(rollbackError)
    }

    if (stopError) {
      console.error(stopError)
      input.setError('Unable to stop the current response.')
    }
  }, [
    abortActiveStreamIfNeeded,
    input,
    resolvePendingStopTurn,
    restorePendingUserMessageToMainComposer,
    restoreUserMessageDraftToMainComposer,
    rollbackPendingUserMessage,
  ])

  const revertUserMessage = useCallback(
    async (messageId: string) => {
      const conversationId = readChatSelectionFromRefs(input).activeConversationId
      if (actionInFlightRef.current || !conversationId) {
        return
      }

      const conversationState = getConversationState(conversationId)
      const isPendingSendRevert = isActiveUnrespondedUserMessage(conversationState, messageId)
      const hasActiveRun = Boolean(conversationState?.isSending || conversationState?.activeStreamId)

      actionInFlightRef.current = true

      try {
        input.clearError()
        if (isPendingSendRevert) {
          const pendingUserMessage = getActiveUnrespondedUserMessage(conversationState, messageId)
          restorePendingUserMessageToMainComposer(conversationId, pendingUserMessage, { restoreComposer: false })
          await abortActiveStreamIfNeeded({ requestAbortBeforeStreamStart: true })
          if (pendingUserMessage) {
            await rollbackPendingUserMessage({
              conversationId,
              message: pendingUserMessage,
            })
          }
          return
        }

        // Capture the complete checkpoint sequence before stopping an active
        // run. The normal abort cleanup removes the in-flight user turn, which
        // would otherwise make the revert target and its later checkpoints
        // unavailable by the time the revert workflow resumes.
        const activeRunRevertPreparation = hasActiveRun
          ? await prepareRevertSessionForMessage(conversationId, messageId)
          : null

        await abortActiveStreamIfNeeded()

        if (activeRunRevertPreparation) {
          const postAbortConversation = getConversationState(conversationId)?.conversation
          const targetStillExists = postAbortConversation?.messages.some(
            (message) => message.id === messageId && message.role === 'user',
          )

          if (!targetStillExists) {
            const messagesThroughTarget = getMessagesThroughUserMessage(
              conversationState?.conversation.messages ?? [],
              messageId,
            )
            if (!messagesThroughTarget) {
              throw new Error(`Message not found: ${messageId}`)
            }

            const restoredConversation = await persistConversationSnapshot(conversationId, messagesThroughTarget, {
              synchronizeCanonicalHistory: true,
            })
            input.upsertConversation(restoredConversation)
            input.updateConversationSummary(restoredConversation)
            if (readChatSelectionFromRefs(input).activeConversationId === conversationId) {
              input.applyConversation(restoredConversation)
            }
          }
        }

        const revertPreparation =
          activeRunRevertPreparation ?? (await prepareRevertSessionForMessage(conversationId, messageId))
        try {
          if (activeRunRevertPreparation) {
            await restoreWorkspaceCheckpointSequence(revertPreparation.checkpointIds)
          } else {
            await restoreWorkspaceCheckpointForMessage(conversationId, messageId)
          }
        } catch (caughtError) {
          if (!isMissingCheckpointError(caughtError)) {
            throw caughtError
          }
        }

        input.beginRevertEditingMessage(conversationId, messageId, revertPreparation.redoCheckpointId)
      } catch (caughtError) {
        console.error(caughtError)
        input.cancelEditingMessage()
        input.setError(toActionErrorMessage(caughtError, 'Unable to revert to that checkpoint.'))
      } finally {
        actionInFlightRef.current = false
      }
    },
    [
      abortActiveStreamIfNeeded,
      getConversationState,
      input,
      restorePendingUserMessageToMainComposer,
      rollbackPendingUserMessage,
    ],
  )

  return {
    abortStreamingResponse,
    revertUserMessage,
    sendEditedMessage,
    sendNewMessage,
    sendProgrammaticMessage,
  }
}
