export interface MutableChatSendGate {
  current: boolean
}

export interface MutableChatSendScopeGate {
  current: Set<string>
}

export function getChatSendScopeKey(conversationId: string | null) {
  return conversationId === null ? 'draft' : `conversation:${conversationId}`
}

export function acquireChatSendGate(gate: MutableChatSendGate) {
  if (gate.current) {
    return false
  }

  gate.current = true
  return true
}

export function releaseChatSendGate(gate: MutableChatSendGate) {
  gate.current = false
}

export function acquireChatSendScopeGate(gate: MutableChatSendScopeGate, scopeKey: string) {
  if (gate.current.has(scopeKey)) {
    return false
  }

  gate.current.add(scopeKey)
  return true
}

export function releaseChatSendScopeGate(gate: MutableChatSendScopeGate, scopeKey: string) {
  gate.current.delete(scopeKey)
}
