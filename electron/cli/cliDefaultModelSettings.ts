import type { AppSettings, ChatProviderId, ReasoningEffort } from '../../src/types/chat'
import { resolveReasoningEffortTransition } from '../../src/lib/reasoningEffortTransition'
import { getStoredSettings, updateStoredSettings } from '../settings/store'
import type { SelectItem } from './interactiveSelect'
import { getConfiguredProviderModels, getTideCodeSystemModels, type SystemModelItem } from './models'
import { colors } from './renderer'
import type { SlashCommandHelpers } from './types'
import { buildTerminalReasoningEffortItems } from './terminalReasoningEffort'

export type CliDefaultModelSettingId = 'agent-model' | 'plan-model' | 'summarization-model'

interface ModelSettingFields {
  label: 'agentModelLabel' | 'planModelLabel' | 'summarizationModelLabel'
  modelId: 'agentModelId' | 'planModelId' | 'summarizationModelId'
  providerId: 'agentModelProviderId' | 'planModelProviderId' | 'summarizationModelProviderId'
  reasoningEffort: 'agentReasoningEffort' | 'planReasoningEffort' | 'summarizationReasoningEffort'
}

export type CliDefaultModelSelection =
  | { kind: 'inherit' }
  | {
      kind: 'model'
      label: string
      modelId: string
      providerId: ChatProviderId
      reasoningEffort: ReasoningEffort
    }

const MODEL_SETTING_FIELDS: Record<CliDefaultModelSettingId, ModelSettingFields> = {
  'agent-model': {
    label: 'agentModelLabel',
    modelId: 'agentModelId',
    providerId: 'agentModelProviderId',
    reasoningEffort: 'agentReasoningEffort',
  },
  'plan-model': {
    label: 'planModelLabel',
    modelId: 'planModelId',
    providerId: 'planModelProviderId',
    reasoningEffort: 'planReasoningEffort',
  },
  'summarization-model': {
    label: 'summarizationModelLabel',
    modelId: 'summarizationModelId',
    providerId: 'summarizationModelProviderId',
    reasoningEffort: 'summarizationReasoningEffort',
  },
}

export const CLI_DEFAULT_MODEL_SETTINGS: ReadonlyArray<{
  id: CliDefaultModelSettingId
  label: string
  description: string
}> = [
  {
    id: 'agent-model',
    label: 'Agent mode model',
    description: 'Default model for Agent mode',
  },
  {
    id: 'plan-model',
    label: 'Plan mode model',
    description: 'Default model for Plan mode',
  },
  {
    id: 'summarization-model',
    label: 'Summarization model',
    description: 'Model used for chat compression and summarization',
  },
]

export function isCliDefaultModelSettingId(value: string): value is CliDefaultModelSettingId {
  return value in MODEL_SETTING_FIELDS
}

export function getCliDefaultModelSettingValue(id: CliDefaultModelSettingId, settings: AppSettings): string {
  const fields = MODEL_SETTING_FIELDS[id]
  const modelId = settings[fields.modelId].trim()
  if (!modelId || settings[fields.providerId] === null) return 'Use chat input model'
  return `${settings[fields.label].trim() || modelId} · ${settings[fields.reasoningEffort]}`
}

export function buildCliDefaultModelSettingsPatch(
  id: CliDefaultModelSettingId,
  selection: CliDefaultModelSelection,
): Partial<AppSettings> {
  const fields = MODEL_SETTING_FIELDS[id]
  if (selection.kind === 'inherit') {
    return {
      [fields.label]: '',
      [fields.modelId]: '',
      [fields.providerId]: null,
    }
  }

  return {
    [fields.label]: selection.label,
    [fields.modelId]: selection.modelId,
    [fields.providerId]: selection.providerId,
    [fields.reasoningEffort]: selection.reasoningEffort,
  }
}

function isCurrentModel(id: CliDefaultModelSettingId, settings: AppSettings, model: SystemModelItem): boolean {
  const fields = MODEL_SETTING_FIELDS[id]
  return settings[fields.modelId] === model.apiModelId && settings[fields.providerId] === model.providerId
}

export async function runCliDefaultModelSetting(
  id: CliDefaultModelSettingId,
  helpers: SlashCommandHelpers,
): Promise<void> {
  const [settings, snapshot] = await Promise.all([getStoredSettings('cli'), getTideCodeSystemModels()])
  const configuredModels = getConfiguredProviderModels(snapshot)
  const fields = MODEL_SETTING_FIELDS[id]
  const inheritsChatModel = settings[fields.modelId].trim().length === 0 || settings[fields.providerId] === null
  const items: Array<SelectItem<CliDefaultModelSelection>> = [
    {
      value: { kind: 'inherit' },
      label: 'Use chat input model',
      description: 'Follow the model selected in the active chat',
      isCurrent: inheritsChatModel,
    },
    ...configuredModels.map((model) => ({
      value: {
        kind: 'model' as const,
        label: model.label,
        modelId: model.apiModelId,
        providerId: model.providerId,
        reasoningEffort: resolveReasoningEffortTransition({
          currentEffort: settings[fields.reasoningEffort],
          defaultEffort: model.defaultReasoningEffort,
          supportedEfforts: model.reasoningEfforts,
        }),
      },
      label: model.label,
      description: model.apiModelId,
      badge: `${colors.cyan}[${model.providerLabel}]${colors.reset}`,
      isCurrent: isCurrentModel(id, settings, model),
    })),
  ]
  const currentIndex = items.findIndex((item) => item.isCurrent)
  const setting = CLI_DEFAULT_MODEL_SETTINGS.find((item) => item.id === id)
  let selected = await helpers.select<CliDefaultModelSelection>({
    title: setting?.label ?? 'Default model',
    items,
    initialIndex: currentIndex >= 0 ? currentIndex : 0,
    pageSize: 7,
    footer: id === 'summarization-model'
      ? 'Only configured providers are shown · Summarization is shared across TideCode'
      : 'Only configured providers are shown · Saved for CLI only',
  })
  if (selected === null) return

  if (selected.kind === 'model') {
    const selectedModelId = selected.modelId
    const selectedProviderId = selected.providerId
    const selectedModel = configuredModels.find(
      (model) => model.apiModelId === selectedModelId && model.providerId === selectedProviderId,
    )
    if (selectedModel) {
      const reasoningItems = buildTerminalReasoningEffortItems(selectedModel, selected.reasoningEffort)
      if (reasoningItems.length > 0) {
        const currentReasoningIndex = reasoningItems.findIndex((item) => item.isCurrent)
        const reasoningEffort = await helpers.select<ReasoningEffort>({
          title: `Reasoning Effort · ${selectedModel.label}`,
          items: reasoningItems,
          initialIndex: currentReasoningIndex >= 0 ? currentReasoningIndex : 0,
          pageSize: 7,
          footer: 'Choose the default effort for this model · Esc cancels',
        })
        if (reasoningEffort === null) return
        selected = { ...selected, reasoningEffort }
      }
    }
  }

  await updateStoredSettings(buildCliDefaultModelSettingsPatch(id, selected), 'cli')
  helpers.renderSuccess(`${setting?.label ?? 'Default model'} saved.`)
}
