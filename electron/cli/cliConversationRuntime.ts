import type { SharedConversationRuntimeSnapshot } from '../../src/types/chat'
import { shouldRefreshCodexUsage } from './cliComposerStatus'
import { findSystemModel, getTideCodeSystemModels } from './models'
import type { TerminalScreen } from './terminalScreen'
import type { CliSessionState } from './types'

export async function applyCliConversationRuntime(
  state: CliSessionState,
  screen: TerminalScreen,
  runtime: SharedConversationRuntimeSnapshot,
): Promise<{ refreshCodexUsage: boolean }> {
  const previousProviderId = state.providerId
  state.chatMode = runtime.chatMode

  if (runtime.model?.providerId) {
    let runtimeModelId = runtime.model.runtimeModelId?.trim() || ''
    if (!runtimeModelId) {
      const snapshot = await getTideCodeSystemModels()
      runtimeModelId = findSystemModel(
        snapshot.allModels,
        runtime.model.modelId,
        runtime.model.providerId,
      )?.apiModelId ?? runtime.model.modelId
    }

    state.modelId = runtimeModelId
    state.providerId = runtime.model.providerId
    if (runtime.model.reasoningEffort) state.reasoningEffort = runtime.model.reasoningEffort
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
