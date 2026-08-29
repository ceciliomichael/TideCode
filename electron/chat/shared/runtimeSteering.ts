import type { ModelMessage } from 'ai'
import type { Message, QueuedMessage, StartChatStreamInput } from '../../../src/types/chat'
import { buildModelMessages, type BuildChatPromptOptions } from './messages'

interface CompletedStepLike {
  toolResults: readonly unknown[]
}

export function hasCompletedToolBoundary(steps: readonly CompletedStepLike[]) {
  return (steps.at(-1)?.toolResults.length ?? 0) > 0
}

export function createSameTurnSteerMessages(
  queuedMessages: readonly QueuedMessage[],
  startInput: StartChatStreamInput,
): Message[] {
  return queuedMessages.map((queuedMessage) => ({
    attachments: queuedMessage.attachments?.map((attachment) => ({ ...attachment })),
    chatMode: startInput.chatMode,
    content: queuedMessage.content,
    id: queuedMessage.id,
    mentionPathMap: queuedMessage.mentionPathMap ? { ...queuedMessage.mentionPathMap } : undefined,
    modelId: startInput.modelId,
    providerId: startInput.providerId,
    reasoningEffort: startInput.reasoningEffort,
    role: 'user',
    timestamp: queuedMessage.timestamp,
    userMessageKind: 'steer',
  }))
}

export function buildSameTurnSteerModelMessages(
  messages: readonly Message[],
  promptOptions: BuildChatPromptOptions,
): ModelMessage[] {
  return buildModelMessages([...messages], {
    ...promptOptions,
    includeExecutionModeContext: false,
  })
}
