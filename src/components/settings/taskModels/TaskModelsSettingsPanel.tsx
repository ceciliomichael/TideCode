import { memo, useCallback, useMemo, useState } from 'react'
import { PROVIDER_SECTIONS } from '../models/modelCatalog'
import { buildModelProviderSections } from '../models/modelViewUtils'
import { SettingsPanelLayout, SETTINGS_SECTION_TITLE_CLASS_NAME } from '../shared/SettingsPanelPrimitives'
import type { AppSettings, ChatProviderId, ProvidersState, ReasoningEffort } from '../../../types/chat'
import { useSettingsModelCatalog } from '../models/settingsModelCatalogStore'
import { filterEnabledModelCatalogItems, readStoredModelToggleState } from '../models/modelStorage'
import { MemoizedContextSettingsSections } from '../context/ContextSettingsPanel'
import type { ContextCompactionSettings } from '../../../lib/contextCompactionSettings'
import { TaskModelsSettingsSkeleton } from './TaskModelsSettingsSkeleton'
import { resolveModelReasoningProfile } from '../../../lib/modelReasoningProfiles'
import { resolveReasoningEffortTransition } from '../../../lib/reasoningEffortTransition'
import { TaskModelConfigurationCard } from './TaskModelConfigurationCard'
import {
  TaskModelConfigurationDialog,
  type TaskModelConfigurationOption,
} from './TaskModelConfigurationDialog'
import { getTaskModelConfigurationSummary } from './taskModelConfiguration'

interface ModelOption {
  defaultReasoningEffort?: ReasoningEffort
  label: string
  modelId: string
  providerId: ChatProviderId
  providerLabel: string
  reasoningEfforts?: readonly ReasoningEffort[]
  value: string
}

type TaskReasoningEffortKey =
  | 'agentReasoningEffort'
  | 'gitCommitReasoningEffort'
  | 'kanbanReasoningEffort'
  | 'planReasoningEffort'
  | 'summarizationReasoningEffort'

interface TaskModelSettingsKeys {
  modelId: 'agentModelId' | 'gitCommitModelId' | 'kanbanModelId' | 'planModelId' | 'summarizationModelId'
  modelLabel:
    | 'agentModelLabel'
    | 'gitCommitModelLabel'
    | 'kanbanModelLabel'
    | 'planModelLabel'
    | 'summarizationModelLabel'
  providerId:
    | 'agentModelProviderId'
    | 'gitCommitModelProviderId'
    | 'kanbanModelProviderId'
    | 'planModelProviderId'
    | 'summarizationModelProviderId'
  reasoningEffort: TaskReasoningEffortKey
}

type TaskModelConfigurationId = 'agent' | 'git-commit' | 'kanban' | 'plan' | 'summarization'

interface TaskModelCardConfiguration {
  description: string
  id: TaskModelConfigurationId
  keys: TaskModelSettingsKeys
  missingOption: ModelOption | null
  modelId: string
  modelLabel: string
  options: readonly TaskModelConfigurationOption[]
  providerId: ChatProviderId | null
  reasoningEffort: ReasoningEffort
  selectedModel: ModelOption | null
  selectedValue: string
  title: string
}

const USE_CHAT_INPUT_MODEL_VALUE = '__use-chat-input-model__'
const USE_CHAT_INPUT_MODEL_OPTION: TaskModelConfigurationOption = {
  label: 'Use chat input model',
  providerLabel: 'Default',
  value: USE_CHAT_INPUT_MODEL_VALUE,
}

interface TaskModelsSettingsPanelProps {
  contextSettings: {
    isLoading: boolean
    onUpdateSettings: (input: Partial<AppSettings>) => void
    settings: ContextCompactionSettings
  }
  isLoading: boolean
  onUpdateSettings: (input: Partial<AppSettings>) => void
  providersState: ProvidersState | null
  settings: Pick<
    AppSettings,
    | 'agentModelId'
    | 'agentModelLabel'
    | 'agentModelProviderId'
    | 'agentReasoningEffort'
    | 'gitCommitModelId'
    | 'gitCommitModelLabel'
    | 'gitCommitModelProviderId'
    | 'gitCommitReasoningEffort'
    | 'kanbanModelId'
    | 'kanbanModelLabel'
    | 'kanbanModelProviderId'
    | 'kanbanReasoningEffort'
    | 'planModelId'
    | 'planModelLabel'
    | 'planModelProviderId'
    | 'planReasoningEffort'
    | 'summarizationModelId'
    | 'summarizationModelLabel'
    | 'summarizationModelProviderId'
    | 'summarizationReasoningEffort'
  >
}

function encodeSelectorValue(providerId: ChatProviderId, modelId: string) {
  return `${providerId}::${modelId}`
}

function getProviderLabel(providerId: ChatProviderId | null) {
  if (providerId === null) return 'Saved model'
  return PROVIDER_SECTIONS.find((provider) => provider.id === providerId)?.label ?? 'Saved model'
}

function getMissingOption(
  modelId: string,
  modelLabel: string,
  modelProviderId: ChatProviderId | null,
): ModelOption | null {
  const normalizedModelId = modelId.trim()
  if (normalizedModelId.length === 0 || modelProviderId === null) return null

  const normalizedModelLabel = modelLabel.trim()
  return {
    label: `${normalizedModelLabel.length > 0 ? normalizedModelLabel : normalizedModelId} (Unavailable)`,
    modelId: normalizedModelId,
    providerId: modelProviderId,
    providerLabel: getProviderLabel(modelProviderId),
    value: encodeSelectorValue(modelProviderId, normalizedModelId),
  }
}

function buildConfigurationOptions(
  baseOptions: readonly ModelOption[],
  missingOption: ModelOption | null,
): TaskModelConfigurationOption[] {
  const withMissing =
    missingOption && !baseOptions.some((option) => option.value === missingOption.value)
      ? [missingOption, ...baseOptions]
      : baseOptions

  return [
    USE_CHAT_INPUT_MODEL_OPTION,
    ...withMissing.map((option) => ({
      defaultReasoningEffort: option.defaultReasoningEffort,
      label: option.label,
      providerLabel: option.providerLabel,
      reasoningEfforts: option.reasoningEfforts,
      value: option.value,
    })),
  ]
}

function findSelectedValue(
  configuredOptions: readonly ModelOption[],
  missingOption: ModelOption | null,
  modelId: string,
  modelProviderId: ChatProviderId | null,
) {
  const normalizedModelId = modelId.trim()
  if (normalizedModelId.length === 0 || modelProviderId === null) return USE_CHAT_INPUT_MODEL_VALUE

  const selectedOption = configuredOptions.find(
    (option) => option.modelId === normalizedModelId && option.providerId === modelProviderId,
  )
  if (selectedOption) return selectedOption.value
  if (missingOption) return missingOption.value
  return USE_CHAT_INPUT_MODEL_VALUE
}

function findSelectedModel(
  configuredOptions: readonly ModelOption[],
  missingOption: ModelOption | null,
  selectedValue: string,
) {
  return configuredOptions.find((option) => option.value === selectedValue)
    ?? (missingOption?.value === selectedValue ? missingOption : null)
}

export function TaskModelsSettingsPanel({
  contextSettings,
  isLoading,
  onUpdateSettings,
  providersState,
  settings,
}: TaskModelsSettingsPanelProps) {
  const [dialogId, setDialogId] = useState<TaskModelConfigurationId | null>(null)
  const { customModels, customModelsLoading, providerModels, providerModelsLoading } = useSettingsModelCatalog(providersState)

  const configuredModelOptions = useMemo<ModelOption[]>(() => {
    const modelToggleState = readStoredModelToggleState()
    const providerSections = buildModelProviderSections('', providersState, customModels, providerModels)
    return providerSections.flatMap((section) =>
      filterEnabledModelCatalogItems(section.models, modelToggleState).map((model) => {
        const reasoningProfile = resolveModelReasoningProfile(model)
        return {
          defaultReasoningEffort: reasoningProfile?.defaultEffort,
          label: model.label,
          modelId: model.id,
          providerId: section.provider.id,
          providerLabel: section.provider.label,
          reasoningEfforts: reasoningProfile?.efforts,
          value: encodeSelectorValue(section.provider.id, model.id),
        }
      }),
    )
  }, [customModels, providerModels, providersState])

  const agentMissingOption = useMemo(
    () => getMissingOption(settings.agentModelId, settings.agentModelLabel, settings.agentModelProviderId),
    [settings.agentModelId, settings.agentModelLabel, settings.agentModelProviderId],
  )
  const planMissingOption = useMemo(
    () => getMissingOption(settings.planModelId, settings.planModelLabel, settings.planModelProviderId),
    [settings.planModelId, settings.planModelLabel, settings.planModelProviderId],
  )
  const summarizationMissingOption = useMemo(
    () => getMissingOption(
      settings.summarizationModelId,
      settings.summarizationModelLabel,
      settings.summarizationModelProviderId,
    ),
    [settings.summarizationModelId, settings.summarizationModelLabel, settings.summarizationModelProviderId],
  )
  const gitCommitMissingOption = useMemo(
    () => getMissingOption(settings.gitCommitModelId, settings.gitCommitModelLabel, settings.gitCommitModelProviderId),
    [settings.gitCommitModelId, settings.gitCommitModelLabel, settings.gitCommitModelProviderId],
  )
  const kanbanMissingOption = useMemo(
    () => getMissingOption(settings.kanbanModelId, settings.kanbanModelLabel, settings.kanbanModelProviderId),
    [settings.kanbanModelId, settings.kanbanModelLabel, settings.kanbanModelProviderId],
  )

  const agentOptions = useMemo(
    () => buildConfigurationOptions(configuredModelOptions, agentMissingOption),
    [agentMissingOption, configuredModelOptions],
  )
  const planOptions = useMemo(
    () => buildConfigurationOptions(configuredModelOptions, planMissingOption),
    [planMissingOption, configuredModelOptions],
  )
  const summarizationOptions = useMemo(
    () => buildConfigurationOptions(configuredModelOptions, summarizationMissingOption),
    [configuredModelOptions, summarizationMissingOption],
  )
  const gitCommitOptions = useMemo(
    () => buildConfigurationOptions(configuredModelOptions, gitCommitMissingOption),
    [gitCommitMissingOption, configuredModelOptions],
  )
  const kanbanOptions = useMemo(
    () => buildConfigurationOptions(configuredModelOptions, kanbanMissingOption),
    [kanbanMissingOption, configuredModelOptions],
  )

  const agentSelectedValue = useMemo(
    () => findSelectedValue(configuredModelOptions, agentMissingOption, settings.agentModelId, settings.agentModelProviderId),
    [agentMissingOption, configuredModelOptions, settings.agentModelId, settings.agentModelProviderId],
  )
  const planSelectedValue = useMemo(
    () => findSelectedValue(configuredModelOptions, planMissingOption, settings.planModelId, settings.planModelProviderId),
    [planMissingOption, configuredModelOptions, settings.planModelId, settings.planModelProviderId],
  )
  const summarizationSelectedValue = useMemo(
    () => findSelectedValue(
      configuredModelOptions,
      summarizationMissingOption,
      settings.summarizationModelId,
      settings.summarizationModelProviderId,
    ),
    [configuredModelOptions, settings.summarizationModelId, settings.summarizationModelProviderId, summarizationMissingOption],
  )
  const gitCommitSelectedValue = useMemo(
    () => findSelectedValue(
      configuredModelOptions,
      gitCommitMissingOption,
      settings.gitCommitModelId,
      settings.gitCommitModelProviderId,
    ),
    [gitCommitMissingOption, configuredModelOptions, settings.gitCommitModelId, settings.gitCommitModelProviderId],
  )
  const kanbanSelectedValue = useMemo(
    () => findSelectedValue(
      configuredModelOptions,
      kanbanMissingOption,
      settings.kanbanModelId,
      settings.kanbanModelProviderId,
    ),
    [kanbanMissingOption, configuredModelOptions, settings.kanbanModelId, settings.kanbanModelProviderId],
  )

  const agentSelectedModel = useMemo(
    () => findSelectedModel(configuredModelOptions, agentMissingOption, agentSelectedValue),
    [agentMissingOption, agentSelectedValue, configuredModelOptions],
  )
  const planSelectedModel = useMemo(
    () => findSelectedModel(configuredModelOptions, planMissingOption, planSelectedValue),
    [planMissingOption, planSelectedValue, configuredModelOptions],
  )
  const summarizationSelectedModel = useMemo(
    () => findSelectedModel(configuredModelOptions, summarizationMissingOption, summarizationSelectedValue),
    [configuredModelOptions, summarizationMissingOption, summarizationSelectedValue],
  )
  const gitCommitSelectedModel = useMemo(
    () => findSelectedModel(configuredModelOptions, gitCommitMissingOption, gitCommitSelectedValue),
    [gitCommitMissingOption, gitCommitSelectedValue, configuredModelOptions],
  )
  const kanbanSelectedModel = useMemo(
    () => findSelectedModel(configuredModelOptions, kanbanMissingOption, kanbanSelectedValue),
    [kanbanMissingOption, kanbanSelectedValue, configuredModelOptions],
  )

  const saveTaskModel = useCallback((
    nextValue: string,
    nextReasoningEffort: ReasoningEffort,
    keys: TaskModelSettingsKeys,
    missingOption: ModelOption | null,
  ) => {
    if (nextValue === USE_CHAT_INPUT_MODEL_VALUE) {
      onUpdateSettings({
        [keys.modelId]: '',
        [keys.modelLabel]: '',
        [keys.providerId]: null,
      })
      return
    }

    const nextOption = configuredModelOptions.find((option) => option.value === nextValue)
      ?? (missingOption?.value === nextValue ? missingOption : null)
    if (!nextOption) return

    onUpdateSettings({
      [keys.modelId]: nextOption.modelId,
      [keys.modelLabel]: nextOption.label.replace(/ \(Unavailable\)$/, ''),
      [keys.providerId]: nextOption.providerId,
      [keys.reasoningEffort]: resolveReasoningEffortTransition({
        currentEffort: nextReasoningEffort,
        defaultEffort: nextOption.defaultReasoningEffort,
        supportedEfforts: nextOption.reasoningEfforts,
      }),
    })
  }, [configuredModelOptions, onUpdateSettings])

  const configurations: TaskModelCardConfiguration[] = [
    {
      description: 'Model used to turn a task title into a reviewable implementation plan.',
      id: 'kanban',
      keys: {
        modelId: 'kanbanModelId',
        modelLabel: 'kanbanModelLabel',
        providerId: 'kanbanModelProviderId',
        reasoningEffort: 'kanbanReasoningEffort',
      },
      missingOption: kanbanMissingOption,
      modelId: settings.kanbanModelId,
      modelLabel: settings.kanbanModelLabel,
      options: kanbanOptions,
      providerId: settings.kanbanModelProviderId,
      reasoningEffort: settings.kanbanReasoningEffort,
      selectedModel: kanbanSelectedModel,
      selectedValue: kanbanSelectedValue,
      title: 'Task planning model',
    },
    {
      description: 'Default model for Agent mode. Model changes inside a chat remain conversation-specific.',
      id: 'agent',
      keys: {
        modelId: 'agentModelId',
        modelLabel: 'agentModelLabel',
        providerId: 'agentModelProviderId',
        reasoningEffort: 'agentReasoningEffort',
      },
      missingOption: agentMissingOption,
      modelId: settings.agentModelId,
      modelLabel: settings.agentModelLabel,
      options: agentOptions,
      providerId: settings.agentModelProviderId,
      reasoningEffort: settings.agentReasoningEffort,
      selectedModel: agentSelectedModel,
      selectedValue: agentSelectedValue,
      title: 'Agent mode model',
    },
    {
      description: 'Default model for Plan mode. Model changes inside a chat remain conversation-specific.',
      id: 'plan',
      keys: {
        modelId: 'planModelId',
        modelLabel: 'planModelLabel',
        providerId: 'planModelProviderId',
        reasoningEffort: 'planReasoningEffort',
      },
      missingOption: planMissingOption,
      modelId: settings.planModelId,
      modelLabel: settings.planModelLabel,
      options: planOptions,
      providerId: settings.planModelProviderId,
      reasoningEffort: settings.planReasoningEffort,
      selectedModel: planSelectedModel,
      selectedValue: planSelectedValue,
      title: 'Plan mode model',
    },
    {
      description: 'Model used for chat compression and summarization.',
      id: 'summarization',
      keys: {
        modelId: 'summarizationModelId',
        modelLabel: 'summarizationModelLabel',
        providerId: 'summarizationModelProviderId',
        reasoningEffort: 'summarizationReasoningEffort',
      },
      missingOption: summarizationMissingOption,
      modelId: settings.summarizationModelId,
      modelLabel: settings.summarizationModelLabel,
      options: summarizationOptions,
      providerId: settings.summarizationModelProviderId,
      reasoningEffort: settings.summarizationReasoningEffort,
      selectedModel: summarizationSelectedModel,
      selectedValue: summarizationSelectedValue,
      title: 'Summarization',
    },
    {
      description: 'Model used for commit messages and pull request summary generation.',
      id: 'git-commit',
      keys: {
        modelId: 'gitCommitModelId',
        modelLabel: 'gitCommitModelLabel',
        providerId: 'gitCommitModelProviderId',
        reasoningEffort: 'gitCommitReasoningEffort',
      },
      missingOption: gitCommitMissingOption,
      modelId: settings.gitCommitModelId,
      modelLabel: settings.gitCommitModelLabel,
      options: gitCommitOptions,
      providerId: settings.gitCommitModelProviderId,
      reasoningEffort: settings.gitCommitReasoningEffort,
      selectedModel: gitCommitSelectedModel,
      selectedValue: gitCommitSelectedValue,
      title: 'Git commit and pull request',
    },
  ]
  const activeConfiguration = dialogId === null
    ? null
    : configurations.find((configuration) => configuration.id === dialogId) ?? null
  const isModelsLoading = customModelsLoading || providerModelsLoading

  if (isLoading || providersState === null || isModelsLoading) return <TaskModelsSettingsSkeleton />

  return (
    <SettingsPanelLayout>
      <section className="flex flex-col gap-4">
        <header className="flex flex-col gap-1 px-1 pt-1">
          <h2 className={SETTINGS_SECTION_TITLE_CLASS_NAME}>Configuration</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Choose the default model and reasoning effort used by each workflow. Open a setup to make changes.
          </p>
        </header>

        <div className="flex flex-col gap-2.5">
          {configurations.map((configuration) => {
            const isConfigured = configuration.modelId.trim().length > 0 && configuration.providerId !== null
            return (
              <TaskModelConfigurationCard
                key={configuration.id}
                isConfigured={isConfigured}
                label={configuration.title}
                summary={getTaskModelConfigurationSummary({
                  defaultReasoningEffort: configuration.selectedModel?.defaultReasoningEffort,
                  modelId: configuration.modelId,
                  modelLabel: configuration.selectedModel?.label ?? configuration.modelLabel,
                  providerId: configuration.providerId,
                  providerLabel: configuration.selectedModel?.providerLabel ?? getProviderLabel(configuration.providerId),
                  reasoningEffort: configuration.reasoningEffort,
                  reasoningEfforts: configuration.selectedModel?.reasoningEfforts,
                })}
                onClick={() => setDialogId(configuration.id)}
              />
            )
          })}
        </div>
      </section>

      <MemoizedContextSettingsSections {...contextSettings} />

      {activeConfiguration ? (
        <TaskModelConfigurationDialog
          key={activeConfiguration.id}
          description={activeConfiguration.description}
          initialModelValue={activeConfiguration.selectedValue}
          initialReasoningEffort={activeConfiguration.reasoningEffort}
          isSubmitting={isLoading}
          options={activeConfiguration.options}
          title={`Configure ${activeConfiguration.title}`}
          onClose={() => setDialogId(null)}
          onSave={({ modelValue, reasoningEffort }) =>
            saveTaskModel(
              modelValue,
              reasoningEffort,
              activeConfiguration.keys,
              activeConfiguration.missingOption,
            )}
        />
      ) : null}
    </SettingsPanelLayout>
  )
}

export const MemoizedTaskModelsSettingsPanel = memo(TaskModelsSettingsPanel)
