import { memo, useCallback, useMemo } from 'react'
import { PROVIDER_SECTIONS } from '../models/modelCatalog'
import { buildModelProviderSections } from '../models/modelViewUtils'
import { ModelSelectorField, type ModelSelectorOption } from '../../chat/ModelSelectorField'
import { SegmentedField } from '../../ui/SegmentedField'
import { SettingsPanelLayout, SettingsRow, SettingsSection } from '../shared/SettingsPanelPrimitives'
import type { AppSettings, ChatProviderId, ProvidersState } from '../../../types/chat'
import { useSettingsModelCatalog } from '../models/settingsModelCatalogStore'
import { filterEnabledModelCatalogItems, readStoredModelToggleState } from '../models/modelStorage'

interface ModelOption {
  label: string
  modelId: string
  providerId: ChatProviderId
  providerLabel: string
  value: string
}

const USE_CHAT_INPUT_MODEL_VALUE = '__use-chat-input-model__'
const USE_CHAT_INPUT_MODEL_OPTION: ModelSelectorOption = {
  label: 'Use chat input model',
  providerLabel: 'Default',
  value: USE_CHAT_INPUT_MODEL_VALUE,
}

interface TaskModelsSettingsPanelProps {
  isLoading: boolean
  onUpdateSettings: (input: Partial<AppSettings>) => void
  providersState: ProvidersState | null
  settings: Pick<
    AppSettings,
    | 'agentModelId'
    | 'agentModelLabel'
    | 'agentModelProviderId'
    | 'gitCommitModelId'
    | 'gitCommitModelLabel'
    | 'gitCommitModelProviderId'
    | 'kanbanAiPlanningEnabled'
    | 'kanbanModelId'
    | 'kanbanModelLabel'
    | 'kanbanModelProviderId'
    | 'planModelId'
    | 'planModelLabel'
    | 'planModelProviderId'
    | 'summarizationModelId'
    | 'summarizationModelLabel'
    | 'summarizationModelProviderId'
  >
}

function toModelSelectorOptions(options: readonly ModelOption[]): ModelSelectorOption[] {
  return options.map((option) => ({
    label: option.label,
    providerLabel: option.providerLabel,
    value: option.value,
  }))
}

function encodeSelectorValue(providerId: ChatProviderId, modelId: string) {
  return `${providerId}::${modelId}`
}

function getProviderLabel(providerId: ChatProviderId | null) {
  if (providerId === null) {
    return 'Saved model'
  }

  return PROVIDER_SECTIONS.find((provider) => provider.id === providerId)?.label ?? 'Saved model'
}

function getMissingOption(
  modelId: string,
  modelLabel: string,
  modelProviderId: ChatProviderId | null,
): ModelOption | null {
  const normalizedModelId = modelId.trim()
  if (normalizedModelId.length === 0 || modelProviderId === null) {
    return null
  }

  const normalizedModelLabel = modelLabel.trim()
  return {
    label: `${normalizedModelLabel.length > 0 ? normalizedModelLabel : normalizedModelId} (Unavailable)`,
    modelId: normalizedModelId,
    providerId: modelProviderId,
    providerLabel: getProviderLabel(modelProviderId),
    value: encodeSelectorValue(modelProviderId, normalizedModelId),
  }
}

function buildSelectorOptions(baseOptions: readonly ModelOption[], missingOption: ModelOption | null) {
  const withMissing =
    missingOption && !baseOptions.some((option) => option.value === missingOption.value)
      ? [missingOption, ...baseOptions]
      : baseOptions
  return [USE_CHAT_INPUT_MODEL_OPTION, ...toModelSelectorOptions(withMissing)]
}

function findSelectedValue(
  configuredOptions: readonly ModelOption[],
  missingOption: ModelOption | null,
  modelId: string,
  modelProviderId: ChatProviderId | null,
) {
  const normalizedModelId = modelId.trim()
  if (normalizedModelId.length === 0 || modelProviderId === null) {
    return USE_CHAT_INPUT_MODEL_VALUE
  }

  const selectedOption = configuredOptions.find(
    (option) => option.modelId === normalizedModelId && option.providerId === modelProviderId,
  )
  if (selectedOption) {
    return selectedOption.value
  }

  if (missingOption) {
    return missingOption.value
  }

  return USE_CHAT_INPUT_MODEL_VALUE
}

export function TaskModelsSettingsPanel({
  isLoading,
  onUpdateSettings,
  providersState,
  settings,
}: TaskModelsSettingsPanelProps) {
  const { customModels, customModelsLoading, providerModels, providerModelsLoading } = useSettingsModelCatalog(providersState)

  const configuredModelOptions = useMemo(() => {
    const modelToggleState = readStoredModelToggleState()
    const providerSections = buildModelProviderSections('', providersState, customModels, providerModels)
    return providerSections.flatMap((section) =>
      filterEnabledModelCatalogItems(section.models, modelToggleState).map((model) => ({
        label: model.label,
        modelId: model.id,
        providerId: section.provider.id,
        providerLabel: section.provider.label,
        value: encodeSelectorValue(section.provider.id, model.id),
      })),
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
    () =>
      getMissingOption(
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

  const isSelectorDisabled = isLoading
  const isModelsLoading = customModelsLoading || providerModelsLoading
  const sharedOptions = configuredModelOptions

  const agentOptions = useMemo(() => buildSelectorOptions(sharedOptions, agentMissingOption), [agentMissingOption, sharedOptions])
  const planOptions = useMemo(() => buildSelectorOptions(sharedOptions, planMissingOption), [planMissingOption, sharedOptions])
  const summarizationOptions = useMemo(
    () => buildSelectorOptions(sharedOptions, summarizationMissingOption),
    [sharedOptions, summarizationMissingOption],
  )
  const gitCommitOptions = useMemo(
    () => buildSelectorOptions(sharedOptions, gitCommitMissingOption),
    [gitCommitMissingOption, sharedOptions],
  )
  const kanbanOptions = useMemo(
    () => buildSelectorOptions(sharedOptions, kanbanMissingOption),
    [kanbanMissingOption, sharedOptions],
  )

  const setTaskModel = useCallback(
    (
      nextValue: string,
      keys: {
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
      },
    ) => {
      if (nextValue === USE_CHAT_INPUT_MODEL_VALUE) {
        onUpdateSettings({
          [keys.modelId]: '',
          [keys.modelLabel]: '',
          [keys.providerId]: null,
        })
        return
      }

      const nextOption = sharedOptions.find((option) => option.value === nextValue)
      if (!nextOption) {
        return
      }

      onUpdateSettings({
        [keys.modelId]: nextOption.modelId,
        [keys.modelLabel]: nextOption.label,
        [keys.providerId]: nextOption.providerId,
      })
    },
    [onUpdateSettings, sharedOptions],
  )

  const agentSelectedValue = useMemo(
    () =>
      findSelectedValue(sharedOptions, agentMissingOption, settings.agentModelId, settings.agentModelProviderId),
    [agentMissingOption, settings.agentModelId, settings.agentModelProviderId, sharedOptions],
  )
  const planSelectedValue = useMemo(
    () => findSelectedValue(sharedOptions, planMissingOption, settings.planModelId, settings.planModelProviderId),
    [planMissingOption, settings.planModelId, settings.planModelProviderId, sharedOptions],
  )
  const summarizationSelectedValue = useMemo(
    () =>
      findSelectedValue(
        sharedOptions,
        summarizationMissingOption,
        settings.summarizationModelId,
        settings.summarizationModelProviderId,
      ),
    [settings.summarizationModelId, settings.summarizationModelProviderId, sharedOptions, summarizationMissingOption],
  )
  const gitCommitSelectedValue = useMemo(
    () =>
      findSelectedValue(sharedOptions, gitCommitMissingOption, settings.gitCommitModelId, settings.gitCommitModelProviderId),
    [gitCommitMissingOption, settings.gitCommitModelId, settings.gitCommitModelProviderId, sharedOptions],
  )
  const kanbanSelectedValue = useMemo(
    () =>
      findSelectedValue(
        sharedOptions,
        kanbanMissingOption,
        settings.kanbanModelId,
        settings.kanbanModelProviderId,
      ),
    [kanbanMissingOption, settings.kanbanModelId, settings.kanbanModelProviderId, sharedOptions],
  )

  return (
    <SettingsPanelLayout>
      <SettingsSection title="Configuration">
        <SettingsRow
          title="AI task planning"
          description="Let the task composer draft context, acceptance criteria, and subtasks for review."
        >
          <SegmentedField
            ariaLabel="AI task planning"
            disabled={isLoading}
            value={settings.kanbanAiPlanningEnabled ? 'on' : 'off'}
            onChange={(value) => onUpdateSettings({ kanbanAiPlanningEnabled: value === 'on' })}
            options={[
              { label: 'Off', value: 'off' },
              { label: 'On', value: 'on' },
            ]}
          />
        </SettingsRow>

        <div className="border-t border-border">
          <SettingsRow
            title="Task planning model"
            description="Model used to turn a task title into a reviewable implementation plan."
          >
            <div className="w-full md:w-[240px] lg:w-[252px]">
              <ModelSelectorField
                className="w-full"
                disabled={isSelectorDisabled || !settings.kanbanAiPlanningEnabled}
                fullWidth
                isLoading={isModelsLoading}
                options={kanbanOptions}
                size="comfortable"
                value={kanbanSelectedValue}
                onChange={(nextValue) =>
                  setTaskModel(nextValue, {
                    modelId: 'kanbanModelId',
                    modelLabel: 'kanbanModelLabel',
                    providerId: 'kanbanModelProviderId',
                  })}
              />
            </div>
          </SettingsRow>
        </div>

        <div className="border-t border-border">
          <SettingsRow
            title="Agent mode model"
            description="Default model for Agent mode. Changes made from chat input in Agent mode are saved here."
          >
            <div className="w-full md:w-[240px] lg:w-[252px]">
              <ModelSelectorField
                className="w-full"
                disabled={isSelectorDisabled}
                fullWidth
                isLoading={isModelsLoading}
                options={agentOptions}
                size="comfortable"
                value={agentSelectedValue}
                onChange={(nextValue) =>
                  setTaskModel(nextValue, {
                    modelId: 'agentModelId',
                    modelLabel: 'agentModelLabel',
                    providerId: 'agentModelProviderId',
                  })}
              />
            </div>
          </SettingsRow>
        </div>

        <div className="border-t border-border">
          <SettingsRow
            title="Plan mode model"
            description="Default model for Plan mode. Changes made from chat input in Plan mode are saved here."
          >
            <div className="w-full md:w-[240px] lg:w-[252px]">
              <ModelSelectorField
                className="w-full"
                disabled={isSelectorDisabled}
                fullWidth
                isLoading={isModelsLoading}
                options={planOptions}
                size="comfortable"
                value={planSelectedValue}
                onChange={(nextValue) =>
                  setTaskModel(nextValue, {
                    modelId: 'planModelId',
                    modelLabel: 'planModelLabel',
                    providerId: 'planModelProviderId',
                  })}
              />
            </div>
          </SettingsRow>
        </div>

        <div className="border-t border-border">
          <SettingsRow
            title="Summarization"
            description="Model for chat compression and summarization. “Use chat input model” follows the active chat model."
          >
            <div className="w-full md:w-[240px] lg:w-[252px]">
              <ModelSelectorField
                className="w-full"
                disabled={isSelectorDisabled}
                fullWidth
                isLoading={isModelsLoading}
                options={summarizationOptions}
                size="comfortable"
                value={summarizationSelectedValue}
                onChange={(nextValue) =>
                  setTaskModel(nextValue, {
                    modelId: 'summarizationModelId',
                    modelLabel: 'summarizationModelLabel',
                    providerId: 'summarizationModelProviderId',
                  })}
              />
            </div>
          </SettingsRow>
        </div>

        <div className="border-t border-border">
          <SettingsRow
            title="Git commit and pull request"
            description="Model for commit message and pull request summary generation."
          >
            <div className="w-full md:w-[240px] lg:w-[252px]">
              <ModelSelectorField
                className="w-full"
                disabled={isSelectorDisabled}
                fullWidth
                isLoading={isModelsLoading}
                options={gitCommitOptions}
                size="comfortable"
                value={gitCommitSelectedValue}
                onChange={(nextValue) =>
                  setTaskModel(nextValue, {
                    modelId: 'gitCommitModelId',
                    modelLabel: 'gitCommitModelLabel',
                    providerId: 'gitCommitModelProviderId',
                  })}
              />
            </div>
          </SettingsRow>
        </div>
      </SettingsSection>
    </SettingsPanelLayout>
  )
}

export const MemoizedTaskModelsSettingsPanel = memo(TaskModelsSettingsPanel)
