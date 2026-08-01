import type {
  ChatMode,
  ChatProviderId,
  ConversationModelPreference,
  ReasoningEffort,
} from '../types/chat'

export interface ActiveConversationModelSelection {
  label: string
  modelId: string
  providerId: ChatProviderId | null
}

interface CreateConversationModelPreferenceInput {
  activeChatMode: ChatMode
  activeSelection: ActiveConversationModelSelection
  previousPreference?: ConversationModelPreference
  reasoningEffort: ReasoningEffort
  selectedModelLabel?: string
}

export function createConversationModelPreference({
  activeChatMode,
  activeSelection,
  previousPreference,
  reasoningEffort,
  selectedModelLabel,
}: CreateConversationModelPreferenceInput): ConversationModelPreference | null {
  const previousModelId = previousPreference?.modelId.trim() ?? ''
  const modelId = previousModelId || activeSelection.modelId.trim()
  if (modelId.length === 0) {
    return null
  }

  const activeLabel = activeSelection.label.trim()
  const fallbackLabel = selectedModelLabel?.trim() ?? ''
  const previousLabel = previousPreference?.label.trim() ?? ''

  return {
    label: previousLabel || activeLabel || fallbackLabel || modelId,
    modelId,
    providerId: previousModelId
      ? previousPreference?.providerId ?? activeSelection.providerId
      : activeSelection.providerId,
    chatMode: previousPreference?.chatMode ?? activeChatMode,
    reasoningEffort,
  }
}
