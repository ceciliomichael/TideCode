import type { Message } from '../types/chat'
import type { PersistAndStreamMessageInput } from './chatMessageSendTypes'

export function createOptimisticUserMessages(
  input: PersistAndStreamMessageInput,
  providerId: NonNullable<PersistAndStreamMessageInput['runtimeSelection']['providerId']>,
  messageIds: readonly string[],
): Message[] {
  const submitted = input.messageBatch ?? [{ attachments: input.attachments, text: input.trimmedText }]
  const timestamp = Date.now()
  return submitted.map((message, index) => ({
    ...(message.attachments.length > 0 ? { attachments: [...message.attachments] } : {}),
    chatMode: input.draftChatMode,
    content: message.text.trim(),
    id: messageIds[index],
    mentionPathMap: message.mentionPathMap,
    modelId: input.runtimeSelection.modelId,
    providerId,
    reasoningEffort: input.runtimeSelection.reasoningEffort,
    role: 'user',
    timestamp: timestamp + index,
  }))
}

// Roll back only the pending presentation. Other turns may have arrived while
// persistence was in flight, and a newer edit must not be replaced by this one.
export function rollbackOptimisticUserMessages(
  current: readonly Message[],
  original: readonly Message[],
  submitted: readonly Message[],
  editedMessageId: string | null,
): Message[] {
  const submittedIds = new Set(submitted.map(message => message.id))
  if (!editedMessageId) {
    return current.filter(message => !submittedIds.has(message.id))
  }

  const currentEdit = current.find(message => message.id === editedMessageId)
  if (currentEdit !== submitted[0]) {
    return [...current]
  }
  const originalIds = new Set(original.map(message => message.id))
  const laterMessages = current.filter(message => !originalIds.has(message.id) && !submittedIds.has(message.id))
  return [...original, ...laterMessages]
}
