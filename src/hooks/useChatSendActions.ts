import { useCallback, useRef, useState } from 'react'
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
import { isPlanStatusMessage } from '../lib/planStatusMessages'
import { getPlanPathsCreatedByRevertedUserMessage } from '../lib/planPresentation'
import { readChatSelectionFromRefs } from '../lib/chatSelection'
import {
  acquireChatSendScopeGate,
  canBeginChatEditedSend,
  getChatSendScopeKey,
  isChatSendBlocked,
  releaseChatSendScopeGate,
  waitForChatSendScopeGateRelease,
} from '../lib/chatSendGate'
import {
  getActiveUnrespondedUserMessage,
  getPendingRevertMessageIds,
  isActiveUnrespondedUserMessage,
} from './chatPendingMessageRevert'
import { stopAndRollbackPendingTurn } from './chatPendingTurnWorkflow'
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
  beginRevertEditingMessage: (
    conversationId: string,
    messageId: string,
    redoCheckpointId: string,
    revertedPlanPaths?: readonly string[],
    chatModeTransition?: {
      chatModeBeforeRevert: ChatMode
      revertedChatMode: ChatMode
    },
  ) => void
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
  const abortResponseOperationRef = useRef<Promise<void> | null>(null)
  const submissionInFlightRef = useRef<Set<string>>(new Set())
  const pendingAbortBeforeStreamStartRef = useRef(false)
  const revertedUserMessageIdsRef = useRef<Set<string>>(new Set())
  const pendingPersistedUserTurnsRef = useRef<Map<string, PersistedUserTurn>>(new Map())
  const suppressAbortComposerRestoreConversationIdsRef = useRef<Set<string>>(new Set())
  const suppressAbortRollbackPresentationConversationIdsRef = useRef<Set<string>>(new Set())
  const [isAbortInProgress, setIsAbortInProgress] = useState(false)

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
    suppressAbortComposerRestoreConversationIdsRef.current.delete(turn.conversationId)
    suppressAbortRollbackPresentationConversationIdsRef.current.delete(turn.conversationId)
  }, [])

  const restoreUserMessageDraftToMainComposer = useCallback(
    (message: Message | null) => {
      if (!message || message.role !== 'user') {
        return false
      }

      if (isPlanStatusMessage(message.content)) {
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
    async (turn: PersistedUserTurn, options: { restoreComposer?: boolean } = {}) => {
      const rolledBackConversation = await rollbackConversationBeforeUserMessage(turn.conversationId, turn.message.id)
      input.upsertConversation(rolledBackConversation)
      input.updateConversationSummary(rolledBackConversation)

      const activeConversationId = readChatSelectionFromRefs(input).activeConversationId
      if (activeConversationId === turn.conversationId) {
        input.applyConversation(rolledBackConversation)
        if (options.restoreComposer !== false) {
          restoreUserMessageDraftToMainComposer(turn.message)
        }
      } else if (activeConversationId === null && options.restoreComposer !== false) {
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

  const prepareMessageRevert = useCallback(
    async (
      conversationId: string,
      messageId: string,
      options: {
        preservePendingMessageBubble: boolean
        restorePendingDraftToComposer: boolean
        suppressActiveRunComposerRestore: boolean
      },
    ) => {
      const conversationState = getConversationState(conversationId)
      const hasActiveRun = Boolean(conversationState?.isSending || conversationState?.activeStreamId)
      const isPendingSendRevert = isActiveUnrespondedUserMessage(conversationState, messageId)
      const shouldSuppressActiveRunComposerRestore =
        hasActiveRun && options.suppressActiveRunComposerRestore

      const beginSuppressingActiveRunComposerRestore = () => {
        if (shouldSuppressActiveRunComposerRestore) {
          suppressAbortComposerRestoreConversationIdsRef.current.add(conversationId)
          suppressAbortRollbackPresentationConversationIdsRef.current.add(conversationId)
        }
      }

      const clearSuppressionIfRunSettled = () => {
        if (!shouldSuppressActiveRunComposerRestore) {
          return
        }

        const currentState = getConversationState(conversationId)
        if (!currentState?.isSending && !currentState?.activeStreamId) {
          suppressAbortComposerRestoreConversationIdsRef.current.delete(conversationId)
          suppressAbortRollbackPresentationConversationIdsRef.current.delete(conversationId)
        }
      }

      if (isPendingSendRevert) {
        const pendingUserMessage = getActiveUnrespondedUserMessage(conversationState, messageId)
        if (options.preservePendingMessageBubble) {
          if (pendingUserMessage) {
            revertedUserMessageIdsRef.current.add(pendingUserMessage.id)
          }
          beginSuppressingActiveRunComposerRestore()
          try {
            if (hasActiveRun) {
              await abortActiveStreamIfNeeded({ requestAbortBeforeStreamStart: true })
            } else {
              await abortActiveStreamIfNeeded()
            }
          } finally {
            clearSuppressionIfRunSettled()
          }
          if (pendingUserMessage) {
            clearUserMessageRevert(pendingUserMessage.id)
          }
          return null
        }

        try {
          await stopAndRollbackPendingTurn({
            prepareLocalRollback: () => {
              beginSuppressingActiveRunComposerRestore()
              restorePendingUserMessageToMainComposer(conversationId, pendingUserMessage, {
                restoreComposer: options.restorePendingDraftToComposer,
              })
            },
            abortActiveRun: () =>
              hasActiveRun
                ? abortActiveStreamIfNeeded({ requestAbortBeforeStreamStart: true })
                : abortActiveStreamIfNeeded(),
            rollbackPersistedTurn: async () => {
              if (!pendingUserMessage) {
                return
              }

              await rollbackPendingUserMessage(
                {
                  conversationId,
                  message: pendingUserMessage,
                },
                { restoreComposer: options.restorePendingDraftToComposer },
              )
            },
          })
        } finally {
          clearSuppressionIfRunSettled()
        }
        if (pendingUserMessage) {
          clearUserMessageRevert(pendingUserMessage.id)
        }
        return null
      }

      const activeRunRevertPreparation = hasActiveRun
        ? await prepareRevertSessionForMessage(conversationId, messageId)
        : null

      beginSuppressingActiveRunComposerRestore()
      try {
        if (hasActiveRun) {
          await abortActiveStreamIfNeeded({ requestAbortBeforeStreamStart: true })
        } else {
          await abortActiveStreamIfNeeded()
        }
      } finally {
        clearSuppressionIfRunSettled()
      }

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

      return revertPreparation
    },
    [
      abortActiveStreamIfNeeded,
      clearUserMessageRevert,
      getConversationState,
      input,
      rollbackPendingUserMessage,
      restorePendingUserMessageToMainComposer,
    ],
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
          shouldApplyAbortRollbackToRuntime: () =>
            activeConversationId === null ||
            !suppressAbortRollbackPresentationConversationIdsRef.current.has(activeConversationId),
          shouldRestoreMainComposerOnAbort: () =>
            activeConversationId === null ||
            !suppressAbortComposerRestoreConversationIdsRef.current.has(activeConversationId),
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
      const editingMessageId = input.editingMessageId
      if (conversationId === null || editingMessageId === null) {
        return
      }

      const sendScopeKey = getChatSendScopeKey(conversationId)
      const conversationState = getConversationState(conversationId)
      const hasActiveRun = Boolean(conversationState?.isSending || conversationState?.activeStreamId)
      const hasSubmissionInFlight = submissionInFlightRef.current.has(sendScopeKey)
      if (!canBeginChatEditedSend({
        actionInFlight: actionInFlightRef.current,
        hasActiveRun,
        hasSubmissionInFlight,
      })) {
        return
      }

      const nextMessageText = messageText ?? input.editComposerValue
      const trimmedText = nextMessageText.trim()
      if (trimmedText.length === 0 && attachments.length === 0) {
        return
      }

      let ownsSendScopeGate = false
      if (!hasSubmissionInFlight) {
        ownsSendScopeGate = acquireChatSendScopeGate(submissionInFlightRef, sendScopeKey)
        if (!ownsSendScopeGate) {
          return
        }
      }

      actionInFlightRef.current = true
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
            (message) => message.id === editingMessageId && message.role === 'user',
          ),
        )
        if (!hasPersistedEditableMessage) {
          input.cancelEditingMessage()
          input.setError('This message is no longer available to edit.')
          return
        }

        const hasEditableMessage = Boolean(
          getConversationState(conversationId)?.conversation.messages.some(
            (message) => message.id === editingMessageId && message.role === 'user',
          ),
        )
        if (!hasEditableMessage) {
          input.cancelEditingMessage()
          input.setError('This message is no longer available to edit.')
          return
        }

        input.clearError()
        await prepareMessageRevert(conversationId, editingMessageId, {
          preservePendingMessageBubble: true,
          restorePendingDraftToComposer: false,
          suppressActiveRunComposerRestore: true,
        })

        await rollbackConversationBeforeUserMessage(conversationId, editingMessageId)

        if (!ownsSendScopeGate) {
          const previousSendReleased = await waitForChatSendScopeGateRelease(
            submissionInFlightRef,
            sendScopeKey,
          )
          if (!previousSendReleased) {
            throw new Error('Timed out while waiting for the stopped response to settle.')
          }

          ownsSendScopeGate = acquireChatSendScopeGate(submissionInFlightRef, sendScopeKey)
          if (!ownsSendScopeGate) {
            throw new Error('Unable to reserve the conversation for the edited message.')
          }
        }

        pendingAbortBeforeStreamStartRef.current = false
        actionInFlightRef.current = false

        await persistAndStreamMessage({
          ...input,
          attachments,
          activeConversationId: conversationId,
          completeEditingAfterPersist: true,
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
          shouldApplyAbortRollbackToRuntime: () =>
            !suppressAbortRollbackPresentationConversationIdsRef.current.has(conversationId),
          shouldRestoreMainComposerOnAbort: () =>
            !suppressAbortComposerRestoreConversationIdsRef.current.has(conversationId),
          isUserMessageReverted,
          clearUserMessageRevert,
          originalText: nextMessageText,
          runtimeSelection,
          selectedFolderId: readChatSelectionFromRefs(input).selectedFolderId,
          targetEditMessageId: null,
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
        actionInFlightRef.current = false
        if (ownsSendScopeGate) {
          releaseChatSendScopeGate(submissionInFlightRef, sendScopeKey)
        }
      }
    },
    [
      clearPersistedUserTurn,
      clearUserMessageRevert,
      getConversationState,
      input,
      isUserMessageReverted,
      prepareMessageRevert,
      registerPersistedUserTurn,
    ],
  )

  const abortStreamingResponse = useCallback(async () => {
    const existingAbortResponseOperation = abortResponseOperationRef.current
    if (existingAbortResponseOperation) {
      await existingAbortResponseOperation
      return
    }

    if (actionInFlightRef.current) {
      return
    }

    setIsAbortInProgress(true)
    const abortResponseOperation = (async () => {
      const conversationId = readChatSelectionFromRefs(input).activeConversationId
      const pendingStopTurn = resolvePendingStopTurn(conversationId)
      let stopError: unknown = null
      try {
        if (pendingStopTurn) {
          await stopAndRollbackPendingTurn({
            prepareLocalRollback: () => {
              restorePendingUserMessageToMainComposer(
                pendingStopTurn.conversationId,
                pendingStopTurn.message,
                { restoreComposer: true },
              )
            },
            abortActiveRun: () => abortActiveStreamIfNeeded({ requestAbortBeforeStreamStart: true }),
            rollbackPersistedTurn: () => rollbackPendingUserMessage(pendingStopTurn),
          })
          clearUserMessageRevert(pendingStopTurn.message.id)
        } else {
          await abortActiveStreamIfNeeded({ requestAbortBeforeStreamStart: true })
        }
      } catch (caughtError) {
        stopError = caughtError
      }

      if (stopError) {
        console.error(stopError)
        input.setError('Unable to stop the current response.')
      }
    })()
    abortResponseOperationRef.current = abortResponseOperation

    try {
      await abortResponseOperation
    } finally {
      if (abortResponseOperationRef.current === abortResponseOperation) {
        abortResponseOperationRef.current = null
      }
      setIsAbortInProgress(false)
    }
  }, [
    abortActiveStreamIfNeeded,
    clearUserMessageRevert,
    input,
    resolvePendingStopTurn,
    restorePendingUserMessageToMainComposer,
    rollbackPendingUserMessage,
  ])

  const revertUserMessage = useCallback(
    async (messageId: string): Promise<boolean> => {
      const conversationId = readChatSelectionFromRefs(input).activeConversationId
      if (actionInFlightRef.current || !conversationId) {
        return false
      }

      const conversationState = getConversationState(conversationId)
      const revertedPlanPaths = getPlanPathsCreatedByRevertedUserMessage(
        conversationState?.conversation.messages ?? [],
        messageId,
      )

      actionInFlightRef.current = true

      try {
        input.clearError()
        const revertPreparation = await prepareMessageRevert(conversationId, messageId, {
          preservePendingMessageBubble: false,
          restorePendingDraftToComposer: true,
          suppressActiveRunComposerRestore: false,
        })
        if (!revertPreparation) {
          return true
        }

        input.beginRevertEditingMessage(
          conversationId,
          messageId,
          revertPreparation.redoCheckpointId,
          revertedPlanPaths,
          {
            chatModeBeforeRevert: input.draftChatMode,
            revertedChatMode: revertPreparation.revertedChatMode,
          },
        )
        return true
      } catch (caughtError) {
        console.error(caughtError)
        input.cancelEditingMessage()
        input.setError(toActionErrorMessage(caughtError, 'Unable to revert to that checkpoint.'))
        return false
      } finally {
        actionInFlightRef.current = false
      }
    },
    [
      getConversationState,
      input,
      prepareMessageRevert,
    ],
  )

  return {
    abortStreamingResponse,
    isAbortInProgress,
    revertUserMessage,
    sendEditedMessage,
    sendNewMessage,
    sendProgrammaticMessage,
  }
}
