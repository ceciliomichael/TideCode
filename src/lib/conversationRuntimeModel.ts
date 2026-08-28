import type { SharedConversationRuntimeModel } from '../types/chat'

export function resolveUpdatedConversationRuntimeModel(input: {
  hasModeUpdate: boolean
  model?: SharedConversationRuntimeModel
  previousModel: SharedConversationRuntimeModel | null | undefined
}): SharedConversationRuntimeModel | null {
  return input.model ?? (input.hasModeUpdate ? null : input.previousModel ?? null)
}
