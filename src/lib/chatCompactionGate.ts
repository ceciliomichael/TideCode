import type { ChatCompactionMarker, Message } from '../types/chat'

export const MIN_COMPACTION_MESSAGE_COUNT = 3

export interface ChatCompactionGateState {
  blockedConversationIds: ReadonlySet<string>
}

export type ChatCompactionGateEvent =
  | { conversationId: string; type: 'compaction_committed' }
  | { conversationId: string; type: 'real_turn_accepted' }

export const EMPTY_CHAT_COMPACTION_GATE_STATE: ChatCompactionGateState = {
  blockedConversationIds: new Set<string>(),
}

function normalizeConversationId(conversationId: string) {
  return conversationId.trim()
}

export function reduceChatCompactionGate(
  currentState: ChatCompactionGateState,
  event: ChatCompactionGateEvent,
): ChatCompactionGateState {
  const conversationId = normalizeConversationId(event.conversationId)
  if (conversationId.length === 0) {
    return currentState
  }

  const isBlocked = currentState.blockedConversationIds.has(conversationId)
  const shouldBlock = event.type === 'compaction_committed'
  if (isBlocked === shouldBlock) {
    return currentState
  }

  const blockedConversationIds = new Set(currentState.blockedConversationIds)
  if (shouldBlock) {
    blockedConversationIds.add(conversationId)
  } else {
    blockedConversationIds.delete(conversationId)
  }

  return { blockedConversationIds }
}

export function isChatCompactionBlocked(
  state: ChatCompactionGateState,
  conversationId: string | null,
) {
  const normalizedConversationId = conversationId?.trim() ?? ''
  return normalizedConversationId.length > 0 && state.blockedConversationIds.has(normalizedConversationId)
}

export function getCompactionBoundaryMessageCount(
  messages: readonly Message[],
  markers: readonly ChatCompactionMarker[],
) {
  const latestMarker = markers.at(-1)
  return messages.filter((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return false
    return !latestMarker || message.timestamp > latestMarker.createdAt
  }).length
}

export function hasMinimumCompactionMessages(
  messages: readonly Message[],
  markers: readonly ChatCompactionMarker[],
) {
  return getCompactionBoundaryMessageCount(messages, markers) >= MIN_COMPACTION_MESSAGE_COUNT
}
