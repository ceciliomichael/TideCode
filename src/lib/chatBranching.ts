import type { Message } from '../types/chat'

export function getConversationBranchMessages(messages: readonly Message[], assistantMessageId: string) {
  const branchMessageIndex = messages.findIndex(
    (message) => message.id === assistantMessageId && message.role === 'assistant',
  )
  if (branchMessageIndex < 0) {
    throw new Error('The assistant message selected for branching no longer exists.')
  }

  return messages.slice(0, branchMessageIndex + 1)
}

export function getConversationBranchTitle(sourceTitle: string) {
  const normalizedTitle = sourceTitle.trim()
  return normalizedTitle.length > 0 ? `Branch · ${normalizedTitle}` : 'Branch'
}
