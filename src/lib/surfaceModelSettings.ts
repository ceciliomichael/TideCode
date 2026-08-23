import type { AppSettings, ChatMode, ChatProviderId, ReasoningEffort } from '../types/chat'

type SurfaceModelSettings = Pick<
  AppSettings,
  | 'agentModelId'
  | 'agentModelLabel'
  | 'agentModelProviderId'
  | 'chatModelId'
  | 'chatModelLabel'
  | 'chatModelProviderId'
  | 'planModelId'
  | 'planModelLabel'
  | 'planModelProviderId'
>

export interface SurfaceModelSelection {
  modelId: string
  modelLabel: string
  providerId: ChatProviderId | null
  updateKeys: {
    modelId: 'agentModelId' | 'planModelId'
    modelLabel: 'agentModelLabel' | 'planModelLabel'
    providerId: 'agentModelProviderId' | 'planModelProviderId'
  }
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
    updateKeys: {
      modelId: 'agentModelId',
      modelLabel: 'agentModelLabel',
      providerId: 'agentModelProviderId',
    },
  }
}

export function buildSurfaceModelSelectionSettingsPatch(
  chatMode: ChatMode,
  selection: {
    modelId: string
    modelLabel: string
    providerId: ChatProviderId | null
    reasoningEffort?: ReasoningEffort
  },
): Partial<AppSettings> {
  const modePatch = chatMode === 'plan'
    ? {
        planModelId: selection.modelId,
        planModelLabel: selection.modelLabel,
        planModelProviderId: selection.providerId,
      }
    : {
        agentModelId: selection.modelId,
        agentModelLabel: selection.modelLabel,
        agentModelProviderId: selection.providerId,
      }

  return {
    ...modePatch,
    chatModelId: selection.modelId,
    chatModelLabel: selection.modelLabel,
    chatModelProviderId: selection.providerId,
    ...(selection.reasoningEffort ? { chatReasoningEffort: selection.reasoningEffort } : {}),
  }
}
