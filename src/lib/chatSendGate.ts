export interface MutableChatSendGate {
  current: boolean
}

export interface MutableChatSendScopeGate {
  current: Set<string>
}

export interface ChatSendBlockedInput {
  actionInFlight: boolean
  hasPendingDraftSend: boolean
  hasSubmissionInFlight: boolean
  isConversationSending: boolean
}

export interface ChatEditedSendAdmissionInput {
  actionInFlight: boolean
  hasActiveRun: boolean
  hasSubmissionInFlight: boolean
}

export function isChatSendBlocked({
  actionInFlight,
  hasPendingDraftSend,
  hasSubmissionInFlight,
  isConversationSending,
}: ChatSendBlockedInput) {
  return actionInFlight || hasPendingDraftSend || hasSubmissionInFlight || isConversationSending
}

export function canBeginChatEditedSend({
  actionInFlight,
  hasActiveRun,
  hasSubmissionInFlight,
}: ChatEditedSendAdmissionInput) {
  return !actionInFlight && (!hasSubmissionInFlight || hasActiveRun)
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

export async function waitForChatSendScopeGateRelease(
  gate: MutableChatSendScopeGate,
  scopeKey: string,
  options: {
    pollIntervalMs?: number
    timeoutMs?: number
  } = {},
) {
  const pollIntervalMs = options.pollIntervalMs ?? 25
  const timeoutMs = options.timeoutMs ?? 20_000
  const startedAt = Date.now()

  while (gate.current.has(scopeKey)) {
    if (Date.now() - startedAt >= timeoutMs) {
      return false
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, pollIntervalMs)
    })
  }

  return true
}
