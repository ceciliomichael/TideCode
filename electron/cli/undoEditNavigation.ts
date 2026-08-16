import type { ChatAttachment, Message } from '../../src/types/chat'
import { isHumanUserMessage } from '../../src/lib/chatMessageMetadata'

export type UndoEditDirection = 'older' | 'newer'

export interface UndoEditSelection {
  targetUserMessageId: string
  text: string
  attachments: ChatAttachment[]
}

export function getUndoEditPreviewMessages(
  messages: readonly Message[],
  targetUserMessageId: string,
): Message[] | null {
  const targetIndex = messages.findIndex(
    (message) => message.id === targetUserMessageId && isHumanUserMessage(message),
  )
  return targetIndex >= 0 ? messages.slice(0, targetIndex) : null
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
