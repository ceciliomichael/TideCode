import type { ChatModeOption } from '../../components/chat/ChatModeSelectorField'
import type { ChatRuntimeSelection } from '../../hooks/useChatMessages'
import type { ChatRuntimeConfigState } from '../../hooks/useChatRuntimeConfig'
import type { AppSettings } from '../../types/chat'

export const CHAT_MODE_OPTIONS: readonly ChatModeOption[] = [
  {
    description: 'Echo can inspect and edit code',
    label: 'Agent',
    value: 'agent',
  },
  {
    description: 'Echo explores and plans with workspace + kanban tools before implementation',
    label: 'Plan',
    value: 'plan',
  },
] as const

export function buildRuntimeSelection(
  chatRuntimeConfig: ChatRuntimeConfigState,
  contextCompaction: AppSettings['contextCompaction'],
  terminalExecutionMode: AppSettings['terminalExecutionMode'],
): ChatRuntimeSelection {
  return {
    contextCompaction,
    hasConfiguredProvider: chatRuntimeConfig.hasConfiguredProvider,
    modelId: chatRuntimeConfig.selectedRuntimeModelId,
    providerId: chatRuntimeConfig.providerId,
    providerLabel: chatRuntimeConfig.providerLabel,
    reasoningEffort: chatRuntimeConfig.reasoningEffort,
    terminalExecutionMode,
  }
}
