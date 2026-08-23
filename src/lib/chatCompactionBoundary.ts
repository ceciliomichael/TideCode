import { normalizeAssistantMessageContent } from './chatMessageContent'
import {
  isHumanUserMessage,
  isPlanImplementationMessage,
  isPlanRevisionMessage,
} from './chatMessageMetadata'
import type { Message } from '../types/chat'

export function isCompactionBoundaryMessage(message: Message) {
  if (message.role === 'assistant') {
    const normalized = normalizeAssistantMessageContent(message)
    return (
      normalized.content.trim().length > 0 ||
      normalized.reasoningContent.trim().length > 0 ||
      (message.toolInvocations?.length ?? 0) > 0
    )
  }

  return (
    isHumanUserMessage(message) ||
    isPlanImplementationMessage(message) ||
    isPlanRevisionMessage(message)
  )
}

export function getCompactionAfterMessageId(messages: readonly Message[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isCompactionBoundaryMessage(messages[index])) {
      return messages[index].id
    }
  }

  return null
}
