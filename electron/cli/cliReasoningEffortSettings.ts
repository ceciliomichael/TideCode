import type { AppSettings, ReasoningEffort } from '../../src/types/chat'
import { createConversationModelPreference } from '../../src/lib/conversationModelPreference'
import { getStoredConversation } from '../history/store'
import { getStoredSettings, updateStoredSettings } from '../settings/store'
import type { CliSessionState } from './types'

export function buildCliReasoningEffortSettingsUpdate(
  state: CliSessionState,
  settings: AppSettings,
  effort: ReasoningEffort,
  modelLabel: string,
  hasPersistedConversation: boolean,
): Partial<AppSettings> {
  const update: Partial<AppSettings> = { chatReasoningEffort: effort }
  if (!hasPersistedConversation) return update

  const previousPreference = settings.conversationModelPreferences[state.conversationId]
  const matchingPreviousPreference =
    previousPreference?.modelId === state.modelId && previousPreference.providerId === state.providerId
      ? previousPreference
      : undefined
  const preference = createConversationModelPreference({
    activeChatMode: state.chatMode,
    activeSelection: {
      label: modelLabel,
      modelId: state.modelId,
      providerId: state.providerId,
    },
    previousPreference: matchingPreviousPreference,
    reasoningEffort: effort,
    selectedModelLabel: modelLabel,
  })

  if (preference) {
    update.conversationModelPreferences = {
      ...settings.conversationModelPreferences,
      [state.conversationId]: preference,
    }
  }
  return update
}

export async function persistCliReasoningEffort(
  state: CliSessionState,
  effort: ReasoningEffort,
  modelLabel: string,
): Promise<void> {
  const [settings, conversation] = await Promise.all([
    getStoredSettings(),
    getStoredConversation(state.conversationId),
  ])
  const update = buildCliReasoningEffortSettingsUpdate(
    state,
    settings,
    effort,
    modelLabel,
    conversation !== null,
  )
  await updateStoredSettings(update)
  state.reasoningEffort = effort
}
