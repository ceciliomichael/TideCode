import { hasMeaningfulAssistantOutput } from './chatMessageRuntime'
import type { Message } from '../types/chat'

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

  const targetMessageIndex = messageId
    ? conversationState.conversation.messages.findIndex(
        (message) => message.id === messageId && message.role === 'user',
      )
    : conversationState.conversation.messages.findLastIndex((message) => message.role === 'user')
  if (targetMessageIndex < 0) {
    return null
  }

  const messagesAfterTarget = conversationState.conversation.messages.slice(targetMessageIndex + 1)
  if (messagesAfterTarget.some((message) => message.role === 'user' || isAssistantResponse(message))) {
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
