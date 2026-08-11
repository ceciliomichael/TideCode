import { hasMeaningfulAssistantOutput } from './chatMessageRuntime'
import type { Message } from '../types/chat'
import { isSameTurnSteerMessage } from '../lib/chatMessageMetadata'

interface ConversationStateForPendingRevert {
  conversation: {
    messages: readonly Message[]
  }
  isSending?: boolean
}

function isAssistantResponse(message: Message) {
  if (message.role === 'tool') {
    return true
  }

  return hasMeaningfulAssistantOutput(message) || (message.toolInvocations?.length ?? 0) > 0
}

function arePartOfTheSameUserBatch(firstMessage: Message | undefined, secondMessage: Message | undefined) {
  return Boolean(
    firstMessage?.role === 'user' &&
      secondMessage?.role === 'user' &&
      firstMessage.runCheckpoint?.id &&
      firstMessage.runCheckpoint.id === secondMessage.runCheckpoint?.id,
  )
}

function isRollbackEligibleUserMessage(message: Message) {
  return message.role === 'user' && !isSameTurnSteerMessage(message)
}

/**
 * Identifies the narrow send -> revert window where no assistant output has
 * been produced yet. A placeholder assistant draft is intentionally ignored;
 * it is still safe to abort and restore the user turn in that state.
 */
export function getActiveUnrespondedUserMessage(
  conversationState: ConversationStateForPendingRevert | null,
  messageId?: string,
) {
  if (!conversationState) {
    return null
  }

  const requestedMessageIndex = messageId
    ? conversationState.conversation.messages.findIndex(
        (message) => message.id === messageId && isRollbackEligibleUserMessage(message),
      )
    : conversationState.conversation.messages.findLastIndex(isRollbackEligibleUserMessage)
  if (requestedMessageIndex < 0) {
    return null
  }

  let targetMessageIndex = requestedMessageIndex

  while (
    targetMessageIndex > 0 &&
    arePartOfTheSameUserBatch(
      conversationState.conversation.messages[targetMessageIndex - 1],
      conversationState.conversation.messages[targetMessageIndex],
    )
  ) {
    targetMessageIndex -= 1
  }

  const messagesAfterTarget = conversationState.conversation.messages.slice(targetMessageIndex + 1)
  const isUserBatch = targetMessageIndex !== requestedMessageIndex ||
    arePartOfTheSameUserBatch(
      conversationState.conversation.messages[targetMessageIndex],
      conversationState.conversation.messages[targetMessageIndex + 1],
    )
  if (
    messagesAfterTarget.some((message) =>
      isUserBatch ? message.role !== 'user' && isAssistantResponse(message) : message.role === 'user' || isAssistantResponse(message),
    )
  ) {
    return null
  }

  return conversationState.conversation.messages[targetMessageIndex] ?? null
}

export function isActiveUnrespondedUserMessage(
  conversationState: ConversationStateForPendingRevert | null,
  messageId: string,
) {
  return getActiveUnrespondedUserMessage(conversationState, messageId) !== null
}

/**
 * Returns every locally-rendered message belonging to an unresponded turn.
 * This includes the empty assistant draft that powers ThinkingIndicator.
 */
export function getPendingRevertMessageIds(
  conversationState: ConversationStateForPendingRevert | null,
  messageId: string,
) {
  if (!getActiveUnrespondedUserMessage(conversationState, messageId) || !conversationState) {
    return []
  }

  const targetMessageIndex = conversationState.conversation.messages.findIndex(
    (message) => message.id === messageId && message.role === 'user',
  )
  if (targetMessageIndex < 0) {
    return []
  }

  return conversationState.conversation.messages.slice(targetMessageIndex).map((message) => message.id)
}
