import type { AppSettings, ChatMode, ChatProviderId, ConversationModelPreference, Message, ReasoningEffort } from '../types/chat'
import { getConversationModeModelPreference } from './conversationModelPreference'

type SurfaceModelSettings = Pick<
  AppSettings,
  | 'agentModelId'
  | 'agentModelLabel'
  | 'agentModelProviderId'
  | 'agentReasoningEffort'
  | 'chatModelId'
  | 'chatModelLabel'
  | 'chatModelProviderId'
  | 'chatReasoningEffort'
  | 'planModelId'
  | 'planModelLabel'
  | 'planModelProviderId'
  | 'planReasoningEffort'
>

export interface SurfaceModelSelection {
  modelId: string
  modelLabel: string
  providerId: ChatProviderId | null
  reasoningEffort?: ReasoningEffort
  updateKeys: {
    modelId: 'agentModelId' | 'planModelId'
    modelLabel: 'agentModelLabel' | 'planModelLabel'
    providerId: 'agentModelProviderId' | 'planModelProviderId'
  }
}
export function resolveConversationModelSelection(
  chatMode: ChatMode,
  defaultSelection: SurfaceModelSelection,
  preference: ConversationModelPreference | null | undefined,
  latestUserMessage: Message | null | undefined,
): SurfaceModelSelection {
  const modePreference = getConversationModeModelPreference(preference, chatMode)
  if (modePreference) {
    return {
      ...defaultSelection,
      modelId: modePreference.modelId,
      modelLabel: modePreference.label,
      providerId: modePreference.providerId,
      reasoningEffort: modePreference.reasoningEffort,
    }
  }

  if (
    latestUserMessage?.role === 'user' &&
    (latestUserMessage.chatMode === undefined || latestUserMessage.chatMode === chatMode) &&
    latestUserMessage.modelId?.trim() &&
    latestUserMessage.providerId
  ) {
    return {
      ...defaultSelection,
      modelId: latestUserMessage.modelId,
      modelLabel: latestUserMessage.modelId,
      providerId: latestUserMessage.providerId,
      reasoningEffort: latestUserMessage.reasoningEffort,
    }
  }

  return defaultSelection
}

export function resolveSurfaceModeModelSelection(
  chatMode: ChatMode,
  settings: SurfaceModelSettings,
): SurfaceModelSelection {
  if (chatMode === 'plan') {
    const hasModeModel = settings.planModelId.trim().length > 0
    return {
      modelId: hasModeModel ? settings.planModelId : settings.chatModelId,
      modelLabel: hasModeModel && settings.planModelLabel.trim().length > 0
        ? settings.planModelLabel
        : settings.chatModelLabel,
      providerId: hasModeModel ? (settings.planModelProviderId ?? settings.chatModelProviderId) : settings.chatModelProviderId,
      reasoningEffort: hasModeModel ? settings.planReasoningEffort : settings.chatReasoningEffort,
      updateKeys: {
        modelId: 'planModelId',
        modelLabel: 'planModelLabel',
        providerId: 'planModelProviderId',
      },
    }
  }

  const hasModeModel = settings.agentModelId.trim().length > 0
  return {
    modelId: hasModeModel ? settings.agentModelId : settings.chatModelId,
    modelLabel: hasModeModel && settings.agentModelLabel.trim().length > 0
      ? settings.agentModelLabel
      : settings.chatModelLabel,
    providerId: hasModeModel ? (settings.agentModelProviderId ?? settings.chatModelProviderId) : settings.chatModelProviderId,
    reasoningEffort: hasModeModel ? settings.agentReasoningEffort : settings.chatReasoningEffort,
    updateKeys: {
      modelId: 'agentModelId',
      modelLabel: 'agentModelLabel',
      providerId: 'agentModelProviderId',
    },
  }
}
