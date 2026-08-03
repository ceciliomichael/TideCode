import { normalizeAssistantMessageContent } from '../../lib/chatMessageContent'
import type { Message } from '../../types/chat'

export interface FinishedAssistantRunPresentation {
  trailingMessage?: Message
  workingMessages: Message[]
}

export function splitFinishedAssistantRun(
  assistantMessages: readonly Message[],
): FinishedAssistantRunPresentation {
  if (assistantMessages.length === 0) {
    return { workingMessages: [] }
  }

  const messages = [...assistantMessages]
  const lastMessage = messages[messages.length - 1]
  const normalizedContent = normalizeAssistantMessageContent(lastMessage)
  const hasReasoning = normalizedContent.reasoningContent.trim().length > 0
  const hasTools = (lastMessage.toolInvocations?.length ?? 0) > 0
  const hasText = normalizedContent.content.trim().length > 0

  if ((hasReasoning || hasTools) && hasText) {
    const workMessage: Message = {
      ...lastMessage,
      content: '',
      id: `${lastMessage.id}-work`,
      reasoningContent: normalizedContent.reasoningContent,
    }
    const textMessage: Message = {
      ...lastMessage,
      content: normalizedContent.content,
      id: `${lastMessage.id}-text`,
      reasoningContent: undefined,
      reasoningCompletedAt: undefined,
      toolInvocations: [],
    }

    return {
      trailingMessage: textMessage,
      workingMessages: [...messages.slice(0, -1), workMessage],
    }
  }

  if (hasReasoning || hasTools) {
    return { workingMessages: messages }
  }

  if (messages.length > 1) {
    return {
      trailingMessage: lastMessage,
      workingMessages: messages.slice(0, -1),
    }
  }

  return {
    trailingMessage: lastMessage,
    workingMessages: [],
  }
}
