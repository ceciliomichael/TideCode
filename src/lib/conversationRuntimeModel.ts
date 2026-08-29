import type { SharedConversationRuntimeModel } from '../types/chat'

export function resolveUpdatedConversationRuntimeModel(input: {
  hasModeUpdate: boolean
  model?: SharedConversationRuntimeModel
  modeModel?: SharedConversationRuntimeModel | null
  previousModel: SharedConversationRuntimeModel | null | undefined
}): SharedConversationRuntimeModel | null {
  return input.model ?? (input.hasModeUpdate ? input.modeModel ?? null : input.previousModel ?? null)
}
