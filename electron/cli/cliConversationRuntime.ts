import type { SharedConversationRuntimeSnapshot } from '../../src/types/chat'
import { shouldRefreshCodexUsage } from './cliComposerStatus'
import { findSystemModel, getTideCodeSystemModels } from './models'
import type { TerminalScreen } from './terminalScreen'
import type { CliSessionState } from './types'

export async function applyCliConversationRuntime(
  state: CliSessionState,
  screen: TerminalScreen,
  runtime: SharedConversationRuntimeSnapshot,
  options: {
    applyModelSelection?: boolean
    getSystemModels?: typeof getTideCodeSystemModels
  } = {},
): Promise<{ refreshCodexUsage: boolean }> {
  const previousProviderId = state.providerId
  const previousChatMode = state.chatMode
  state.chatMode = runtime.chatMode
  const getSystemModels = options.getSystemModels ?? getTideCodeSystemModels

  if (options.applyModelSelection !== false && runtime.model?.providerId) {
    let runtimeModelId = runtime.model.runtimeModelId?.trim() || ''
    if (!runtimeModelId) {
      const snapshot = await getSystemModels(runtime.chatMode)
      runtimeModelId = findSystemModel(
        snapshot.allModels,
        runtime.model.modelId,
        runtime.model.providerId,
      )?.apiModelId ?? runtime.model.modelId
    }

    state.modelId = runtimeModelId
    state.providerId = runtime.model.providerId
    if (runtime.model.reasoningEffort) state.reasoningEffort = runtime.model.reasoningEffort
  } else if (options.applyModelSelection !== false && previousChatMode !== runtime.chatMode) {
    const snapshot = await getSystemModels(runtime.chatMode)
    state.modelId = snapshot.defaultModelId
    state.providerId = snapshot.defaultProviderId
    state.reasoningEffort = snapshot.selectedReasoningEffort
  }

  screen.updateSession({
    mode: state.chatMode,
    model: state.modelId,
    provider: state.providerId,
  })
  screen.updateComposerStatus({ reasoningEffort: state.reasoningEffort })
  return {
    refreshCodexUsage: shouldRefreshCodexUsage(previousProviderId, state.providerId),
  }
}
