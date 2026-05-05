import type { Message } from '../../types/chat'
import type { KanbanSourceMessage } from './kanbanTypes'

const MAX_SOURCE_MESSAGES = 6

function toMessagePreview(content: string) {
  const normalizedContent = content.replace(/\s+/g, ' ').trim()
  if (normalizedContent.length <= 96) {
    return normalizedContent
  }

  return `${normalizedContent.slice(0, 93)}...`
}

export function getKanbanSourceMessages(messages: readonly Message[]): KanbanSourceMessage[] {
  return messages
    .filter((message) => message.role === 'user' && message.content.trim().length > 0)
    .slice(-MAX_SOURCE_MESSAGES)
    .reverse()
    .map((message) => ({
      id: message.id,
      label: toMessagePreview(message.content),
      message,
    }))
}

export function createCardTitleFromMessage(message: Message) {
  const firstLine = message.content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  if (!firstLine) {
    return 'Untitled task'
  }

  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine
}
