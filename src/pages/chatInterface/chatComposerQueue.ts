import { v4 as uuidv4 } from 'uuid'
import type { ChatAttachment, QueuedMessage } from '../../types/chat'

export interface QueuedComposerMessageInput {
  attachments?: ChatAttachment[]
  content: string
}

export function createQueuedComposerMessage(input: QueuedComposerMessageInput): QueuedMessage {
  return {
    attachments: input.attachments?.length ? [...input.attachments] : undefined,
    content: input.content,
    id: uuidv4(),
    timestamp: Date.now(),
  }
}

export function updateQueuedComposerMessage(
  messages: readonly QueuedMessage[],
  id: string,
  nextContent: string,
  nextAttachments?: ChatAttachment[],
) {
  return messages.map((message) =>
    message.id === id
      ? {
          ...message,
          attachments: nextAttachments?.length ? [...nextAttachments] : undefined,
          content: nextContent,
        }
      : message,
  )
}

export function removeQueuedComposerMessage(messages: readonly QueuedMessage[], id: string) {
  return messages.filter((message) => message.id !== id)
}

export function requeueQueuedComposerMessage(
  messages: readonly QueuedMessage[],
  message: QueuedMessage,
  restoreIndex: number,
) {
  if (messages.some((queuedMessage) => queuedMessage.id === message.id)) {
    return [...messages]
  }

  const nextMessages = [...messages]
  nextMessages.splice(Math.max(restoreIndex, 0), 0, message)
  return nextMessages
}

export function dequeueQueuedComposerMessage(messages: readonly QueuedMessage[]) {
  if (messages.length === 0) {
    return {
      nextMessage: null,
      remainingMessages: [] as QueuedMessage[],
    }
  }

  const [nextMessage, ...remainingMessages] = messages
  return {
    nextMessage,
    remainingMessages,
  }
}
