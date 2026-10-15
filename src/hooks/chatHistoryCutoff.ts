import type { Message } from '../types/chat'

export function applyHistoryCutoff(
  messages: readonly Message[],
  messageId: string | null | undefined,
): Message[] {
  if (!messageId) {
    return messages as Message[]
  }

  const targetIndex = messages.findIndex(
    (message) => message.id === messageId && message.role === 'user',
  )
  return targetIndex < 0 ? (messages as Message[]) : messages.slice(0, targetIndex + 1)
}
