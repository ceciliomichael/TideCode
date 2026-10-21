import type { Message } from '../types/chat'
import {
  applyOptimisticEditedMessagePresentation,
  type OptimisticEditedMessagePresentation,
} from './chatOptimisticEditPresentation'

export function projectHistoryCutoff(
  messages: readonly Message[],
  messageId: string | null | undefined,
  submittedEdit?: OptimisticEditedMessagePresentation | null,
) {
  const targetIndex = messageId ? messages.findIndex(
    (message) => message.id === messageId && message.role === 'user',
  ) : -1
  const retainedMessages = targetIndex < 0 ? messages : messages.slice(0, targetIndex + 1)
  const contextMessages = applyOptimisticEditedMessagePresentation(retainedMessages, submittedEdit)

  // Reverting restores a checkpoint, but preserves the visible transcript while
  // the user edits. Submitting the replacement removes the old branch at once.
  return {
    contextMessages,
    displayMessages: submittedEdit ? contextMessages : messages as Message[],
  }
}
