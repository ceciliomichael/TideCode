export interface MutableChatSendGate {
  current: boolean
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
