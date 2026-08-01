import { useCallback, useRef } from 'react'
import {
  prepareRevertSessionForMessage,
  rollbackConversationBeforeUserMessage,
  restoreWorkspaceCheckpointForMessage,
} from './chatHistoryWorkflows'
import { persistAndStreamMessage } from './chatMessageSendWorkflow'
import type { ChatRuntimeSelection } from './chatMessageRuntime'
import type { PersistAndStreamMessageInput } from './chatMessageSendTypes'
import { restoreChatComposerDraft } from '../lib/chatComposerDraft'
import { acquireChatSendGate, releaseChatSendGate } from '../lib/chatSendGate'
import {
  getActiveUnrespondedUserMessage,
  getPendingRevertMessageIds,
  isActiveUnrespondedUserMessage,
} from './chatPendingMessageRevert'
import type { ChatMode, Message } from '../types/chat'

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
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return fallbackMessage
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds)
  })
}

export function useChatSendActions(input: UseChatSendActionsInput) {
  const actionInFlightRef = useRef(false)
  const submissionInFlightRef = useRef(false)
  const pendingAbortBeforeStreamStartRef = useRef(false)
  const revertedUserMessageIdsRef = useRef<Set<string>>(new Set())

  const isUserMessageReverted = useCallback((messageId: string) => {
    return revertedUserMessageIdsRef.current.has(messageId)
  }, [])

  const clearUserMessageRevert = useCallback((messageId: string) => {
    revertedUserMessageIdsRef.current.delete(messageId)
  }, [])

  const restorePendingUserMessageToMainComposer = useCallback(
    (conversationId: string, message: Message | null) => {
      if (!message || message.role !== 'user') {
        return false
      }

      revertedUserMessageIdsRef.current.add(message.id)
      input.cancelEditingMessage()
      const restoredComposerDraft = restoreChatComposerDraft(message.content)
      input.setMainComposerValue(restoredComposerDraft.value)
      input.setMainComposerAttachments(message.attachments ?? [])
      input.setMainComposerMentionPathMap(restoredComposerDraft.mentionPathMap)

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
    [input],
  )

  const getConversationState = useCallback(
    (conversationId: string) => input.conversationRuntimeStatesRef.current[conversationId] ?? null,
    [input.conversationRuntimeStatesRef],
  )

  const findActiveRunConversationId = useCallback(() => {
    const activeConversationId = input.activeConversationIdRef.current ?? input.activeConversationId
    if (activeConversationId) {
      return activeConversationId
    }

    const activeEntry = Object.values(input.conversationRuntimeStatesRef.current).find(
      (conversationState) => conversationState.isSending || conversationState.activeStreamId !== null,
    )

    return activeEntry?.conversation.id ?? null
  }, [input.activeConversationId, input.activeConversationIdRef, input.conversationRuntimeStatesRef])

  const waitForConversationRunState = useCallback(
    async (
      conversationId: string,
      predicate: (conversationState: ConversationStateSnapshot) => boolean,
      timeoutMs = 4_000,
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

  const waitForAbortableConversationId = useCallback(async () => {
    const immediateConversationId = findActiveRunConversationId()
    if (immediateConversationId) {
      return immediateConversationId
    }

    const startedAt = Date.now()
    while (Date.now() - startedAt < 4_000) {
      const conversationId = findActiveRunConversationId()
      if (conversationId) {
        return conversationId
      }

      await sleep(25)
    }

    return null
  }, [findActiveRunConversationId])

  const abortActiveStreamIfNeeded = useCallback(
    async (options?: { requestAbortBeforeStreamStart?: boolean }) => {
      if (options?.requestAbortBeforeStreamStart) {
        pendingAbortBeforeStreamStartRef.current = true
      }

      const conversationId = await waitForAbortableConversationId()
      if (!conversationId) {
        return
      }

      let conversationState = getConversationState(conversationId)
      if (!conversationState) {
        return
      }

      if (!conversationState?.isSending && conversationState?.activeStreamId === null) {
        return
      }

      if (!conversationState?.activeStreamId && conversationState?.isSending) {
        conversationState = await waitForConversationRunState(
          conversationId,
          (currentValue) => !currentValue?.isSending || currentValue.activeStreamId !== null,
        )
      }

      const streamId = conversationState?.activeStreamId ?? null
      if (streamId) {
        await window.echosphereChat.cancelStream(streamId)
      }

      await waitForConversationRunState(
        conversationId,
        (currentValue) => currentValue?.isSending !== true && currentValue?.activeStreamId === null,
      )
    },
    [getConversationState, waitForAbortableConversationId, waitForConversationRunState],
  )

  const sendNewMessage = useCallback(
    async (
      runtimeSelection: ChatRuntimeSelection,
      messageText?: string,
      attachments = input.mainComposerAttachments,
      options?: SendNewMessageOptions,
    ) => {
      const activeConversationId = input.activeConversationIdRef.current ?? input.activeConversationId
      const isActiveConversationSending = activeConversationId
        ? (getConversationState(activeConversationId)?.isSending ?? false)
        : false

      if (
        submissionInFlightRef.current ||
        actionInFlightRef.current ||
        isActiveConversationSending ||
        (activeConversationId === null && input.pendingDraftSendCount > 0)
      ) {
        return false
      }

      const nextMessageText = messageText ?? input.mainComposerValue
      const trimmedText = nextMessageText.trim()
      if (trimmedText.length === 0 && attachments.length === 0) {
        return false
      }

      if (!acquireChatSendGate(submissionInFlightRef)) {
        return false
      }

      pendingAbortBeforeStreamStartRef.current = false

      try {
        return await persistAndStreamMessage({
          ...input,
          attachments,
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
          resetMainComposerAfterSend: options?.resetMainComposerAfterSend,
          runtimeSelection,
          targetEditMessageId: null,
          trimmedText,
        })
      } finally {
        releaseChatSendGate(submissionInFlightRef)
      }
    },
    [clearUserMessageRevert, getConversationState, input, isUserMessageReverted],
  )

  const sendProgrammaticMessage = useCallback(
    async (
      runtimeSelection: ChatRuntimeSelection,
      messageText: string,
      options?: SendProgrammaticMessageOptions,
    ) => {
      const activeConversationId = options?.forceNewConversation
        ? null
        : input.activeConversationIdRef.current ?? input.activeConversationId
      const isActiveConversationSending = activeConversationId
        ? (getConversationState(activeConversationId)?.isSending ?? false)
        : false

      if (
        submissionInFlightRef.current ||
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

      if (!acquireChatSendGate(submissionInFlightRef)) {
        return
      }

      pendingAbortBeforeStreamStartRef.current = false

      try {
        await persistAndStreamMessage({
          ...input,
          attachments: [],
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
          activeConversationId,
          activeConversationIdRef: options?.forceNewConversation ? { current: null } : input.activeConversationIdRef,
          compactionSourceConversationId: options?.compactionSourceConversationId,
          resetMainComposerAfterSend: false,
          runtimeSelection,
          targetEditMessageId: null,
          trimmedText,
          syntheticAssistantMessage: options?.syntheticAssistantMessage,
          title: options?.title,
        })
      } finally {
        releaseChatSendGate(submissionInFlightRef)
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
      const conversationId = input.activeConversationIdRef.current ?? input.activeConversationId
      if (
        submissionInFlightRef.current ||
        actionInFlightRef.current ||
        input.editingMessageId === null ||
        conversationId === null
      ) {
        return
      }

      const nextMessageText = messageText ?? input.editComposerValue
      const trimmedText = nextMessageText.trim()
      if (trimmedText.length === 0 && attachments.length === 0) {
        return
      }

      if (!acquireChatSendGate(submissionInFlightRef)) {
        return
      }

      try {
        let persistedConversation
        try {
          persistedConversation = await window.echosphereHistory.getConversation(conversationId)
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
        releaseChatSendGate(submissionInFlightRef)
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

    const conversationId = input.activeConversationIdRef.current ?? input.activeConversationId
    if (conversationId) {
      const pendingUserMessage = getActiveUnrespondedUserMessage(getConversationState(conversationId))
      if (pendingUserMessage) {
        restorePendingUserMessageToMainComposer(conversationId, pendingUserMessage)
      }
    }

    try {
      await abortActiveStreamIfNeeded({ requestAbortBeforeStreamStart: true })
    } catch (caughtError) {
      console.error(caughtError)
      input.setError('Unable to stop the current response.')
    }
  }, [abortActiveStreamIfNeeded, getConversationState, input, restorePendingUserMessageToMainComposer])

  const revertUserMessage = useCallback(
    async (messageId: string) => {
      const conversationId = input.activeConversationIdRef.current ?? input.activeConversationId
      if (actionInFlightRef.current || submissionInFlightRef.current || !conversationId) {
        return
      }

      const conversationState = getConversationState(conversationId)
      const isPendingSendRevert = isActiveUnrespondedUserMessage(conversationState, messageId)

      actionInFlightRef.current = true

      try {
        input.clearError()
        if (isPendingSendRevert) {
          const pendingUserMessage = getActiveUnrespondedUserMessage(conversationState, messageId)
          restorePendingUserMessageToMainComposer(conversationId, pendingUserMessage)
          await abortActiveStreamIfNeeded({ requestAbortBeforeStreamStart: true })
          const rolledBackConversation = await rollbackConversationBeforeUserMessage(conversationId, messageId)
          input.upsertConversation(rolledBackConversation)
          input.updateConversationSummary(rolledBackConversation)
          if ((input.activeConversationIdRef.current ?? input.activeConversationId) === conversationId) {
            input.applyConversation(rolledBackConversation)
          }
          return
        }

        await abortActiveStreamIfNeeded()
        const revertPreparation = await prepareRevertSessionForMessage(conversationId, messageId)
        try {
          await restoreWorkspaceCheckpointForMessage(conversationId, messageId)
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
