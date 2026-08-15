import { buildCodexUsageSummaryItems } from '../../src/components/chat/codexUsage'
import { DEFAULT_CONTEXT_COMPACTION_SETTINGS } from '../../src/lib/contextCompactionSettings'
import { estimateToolEnabledContextUsage } from '../chat/shared/runtimeContextUsage'
import { getCodexProviderStatus } from '../providers/codex/service'
import { getStoredSettings } from '../settings/store'
import type { CliSessionState } from './types'
import type { TerminalScreen } from './terminalScreen'

export function shouldRefreshCodexUsage(previousProviderId: string, nextProviderId: string): boolean {
  return previousProviderId !== 'codex' && nextProviderId === 'codex'
}

export async function refreshCliComposerStatus(
  state: CliSessionState,
  screen: TerminalScreen,
  options: { refreshCodexUsage?: boolean } = {},
): Promise<void> {
  const runtimeSnapshot = {
    chatMode: state.chatMode,
    conversationId: state.conversationId,
    modelId: state.modelId,
    providerId: state.providerId,
    terminalExecutionMode: state.terminalExecutionMode,
  }
  const settings = await getStoredSettings()
  const [usage, codexStatus] = await Promise.all([
    estimateToolEnabledContextUsage({
      agentContextRootPath: state.workspaceRootPath,
      chatMode: runtimeSnapshot.chatMode,
      conversationId: runtimeSnapshot.conversationId,
      contextCompaction: settings.contextCompaction ?? DEFAULT_CONTEXT_COMPACTION_SETTINGS,
      messages: state.messages,
      modelId: runtimeSnapshot.modelId,
      providerId: runtimeSnapshot.providerId,
      terminalExecutionMode: runtimeSnapshot.terminalExecutionMode,
      webContents: null,
    }),
    runtimeSnapshot.providerId === 'codex'
      ? getCodexProviderStatus(options.refreshCodexUsage === true)
      : Promise.resolve(null),
  ])
  if (
    state.chatMode !== runtimeSnapshot.chatMode
    || state.conversationId !== runtimeSnapshot.conversationId
    || state.modelId !== runtimeSnapshot.modelId
    || state.providerId !== runtimeSnapshot.providerId
    || state.terminalExecutionMode !== runtimeSnapshot.terminalExecutionMode
  ) return

  const activeUsage = codexStatus?.accounts.find((account) => account.isActive)?.usage ?? null
  const codexSummary = buildCodexUsageSummaryItems(activeUsage)[0]
  const totalTokens = Number.isFinite(usage.totalTokens)
    ? usage.totalTokens ?? 0
    : usage.systemPromptTokens + usage.historyTokens + usage.toolResultsTokens
  const contextPercent = usage.maxTokens > 0 ? (totalTokens / usage.maxTokens) * 100 : 0
  screen.updateComposerStatus({
    contextPercent,
    codexUsage: codexSummary ? `${codexSummary.label} ${codexSummary.remainingPercent}%` : undefined,
    reasoningEffort: state.reasoningEffort,
  })
}
