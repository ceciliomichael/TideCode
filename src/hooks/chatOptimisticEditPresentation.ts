import type { ChatAttachment, Message } from '../types/chat'

export interface OptimisticEditedMessagePresentation {
  attachments: ChatAttachment[]
  content: string
  mentionPathMap?: Record<string, string>
  messageId: string
}

export function applyOptimisticEditedMessagePresentation(
  messages: readonly Message[],
  presentation: OptimisticEditedMessagePresentation | null | undefined,
): Message[] {
  if (!presentation) {
    return messages as Message[]
  }

  const targetIndex = messages.findIndex(
    (message) => message.id === presentation.messageId && message.role === 'user',
  )
  if (targetIndex < 0) {
    return messages as Message[]
  }

  const targetMessage = messages[targetIndex]
  return [
    ...messages.slice(0, targetIndex),
    {
      ...targetMessage,
      attachments: presentation.attachments.map((attachment) => ({ ...attachment })),
      content: presentation.content,
      mentionPathMap: presentation.mentionPathMap,
    },
  ]
}
