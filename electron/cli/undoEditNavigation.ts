import type { ChatAttachment, Message } from '../../src/types/chat'
import { isHumanUserMessage } from '../../src/lib/chatMessageMetadata'

export type UndoEditDirection = 'older' | 'newer'

export interface UndoEditSelection {
  targetUserMessageId: string
  text: string
  attachments: ChatAttachment[]
}


function toSelection(message: Message): UndoEditSelection {
  return {
    targetUserMessageId: message.id,
    text: typeof message.content === 'string' ? message.content : '',
    attachments: [...(message.attachments ?? [])],
  }
}

export function getLatestUndoEditSelection(messages: readonly Message[]): UndoEditSelection | null {
  const userMessages = messages.filter(isHumanUserMessage)
  const message = userMessages.at(-1)
  return message ? toSelection(message) : null
}

export function navigateUndoEditSelection(
  messages: readonly Message[],
  currentUserMessageId: string,
  direction: UndoEditDirection,
): UndoEditSelection | null {
  const userMessages = messages.filter(isHumanUserMessage)
  const currentIndex = userMessages.findIndex((message) => message.id === currentUserMessageId)
  if (currentIndex < 0) return null
  const nextIndex = currentIndex + (direction === 'older' ? -1 : 1)
  const message = userMessages[nextIndex]
  return message ? toSelection(message) : null
}
