import type {
  ChatMode,
  ChatProviderId,
  ConversationModeModelPreference,
  ConversationModelPreference,
  ReasoningEffort,
} from '../types/chat'

function normalizeModePreference(
  preference: ConversationModeModelPreference | null | undefined,
): ConversationModeModelPreference | null {
  const modelId = preference?.modelId.trim() ?? ''
  if (!modelId) return null

  return {
    label: preference?.label.trim() || modelId,
    modelId,
    providerId: preference?.providerId ?? null,
    ...(preference?.reasoningEffort ? { reasoningEffort: preference.reasoningEffort } : {}),
  }
}

export function getConversationModeModelPreference(
  preference: ConversationModelPreference | null | undefined,
  chatMode: ChatMode,
): ConversationModeModelPreference | null {
  const modePreference = normalizeModePreference(preference?.modeSelections?.[chatMode])
  if (modePreference) return modePreference

  if (!preference || (preference.chatMode !== undefined && preference.chatMode !== chatMode)) {
    return null
  }

  return normalizeModePreference(preference)
}

export function mergeConversationModeModelPreference(
  previousPreference: ConversationModelPreference | null | undefined,
  chatMode: ChatMode,
  nextPreference: ConversationModeModelPreference,
): ConversationModelPreference {
  const normalizedNext = normalizeModePreference(nextPreference)
  if (!normalizedNext) {
    throw new Error('A conversation model preference requires a model ID.')
  }

  const modeSelections = { ...previousPreference?.modeSelections }
  const legacyPreference = normalizeModePreference(previousPreference)
  if (legacyPreference) {
    if (previousPreference?.chatMode) {
      modeSelections[previousPreference.chatMode] ??= legacyPreference
    } else {
      modeSelections.agent ??= legacyPreference
      modeSelections.plan ??= legacyPreference
    }
  }
  modeSelections[chatMode] = normalizedNext

  return {
    ...normalizedNext,
    chatMode,
    modeSelections,
  }
}

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
  const previousModePreference = getConversationModeModelPreference(previousPreference, activeChatMode)
  const previousModelId = previousModePreference?.modelId.trim() ?? ''
  const modelId = previousModelId || activeSelection.modelId.trim()
  if (modelId.length === 0) {
    return null
  }

  const activeLabel = activeSelection.label.trim()
  const fallbackLabel = selectedModelLabel?.trim() ?? ''
  const previousLabel = previousModePreference?.label.trim() ?? ''

  return mergeConversationModeModelPreference(previousPreference, activeChatMode, {
    label: previousLabel || activeLabel || fallbackLabel || modelId,
    modelId,
    providerId: previousModelId
      ? previousModePreference?.providerId ?? activeSelection.providerId
      : activeSelection.providerId,
    reasoningEffort,
  })
}
