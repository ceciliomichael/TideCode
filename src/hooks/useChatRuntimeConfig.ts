import { useCallback, useEffect, useMemo } from 'react'
import { MODEL_CATALOG, PROVIDER_SECTIONS } from '../components/settings/models/modelCatalog'
import { useSettingsModelCatalog } from '../components/settings/models/settingsModelCatalogStore'
import { toCustomModelCatalogItems } from '../components/settings/models/customModelUtils'
import { toProviderModelCatalogItems } from '../components/settings/models/providerModelUtils'
import { dedupeModelCatalogItems } from '../components/settings/models/modelCatalogDedupe'
import { filterEnabledModelCatalogItems, readStoredModelToggleState } from '../components/settings/models/modelStorage'
import { isProviderConfigured } from '../components/settings/models/modelViewUtils'
import {
  normalizeReasoningEffort,
} from '../lib/reasoningEffort'
import { resolveModelReasoningProfile } from '../lib/modelReasoningProfiles'
import type {
  AppSettings,
  ChatMode,
  ChatProviderId,
  CustomModelConfig,
  ProviderModelConfig,
  ProvidersState,
  ReasoningEffort,
} from '../types/chat'
import type { ModelCatalogItem } from '../components/settings/models/modelTypes'

interface ChatModelOption {
  defaultReasoningEffort?: ReasoningEffort
  id: string
  isCatalogBacked: boolean
  label: string
  providerId: ChatProviderId | null
  providerLabel: string
  reasoningCapable: boolean
  reasoningEfforts?: readonly ReasoningEffort[]
  runtimeModelId: string
}

function buildChatModelOptions(
  providersState: ProvidersState | null,
  customModels: readonly CustomModelConfig[],
  providerModels: readonly ProviderModelConfig[],
): ChatModelOption[] {
  const modelToggleState = readStoredModelToggleState()
  const modelCatalog = filterEnabledModelCatalogItems(dedupeModelCatalogItems([
    ...MODEL_CATALOG,
    ...toProviderModelCatalogItems(providerModels),
    ...toCustomModelCatalogItems(customModels),
  ]), modelToggleState)

  const customProviderSections = (providersState?.apiKeyProviders ?? [])
    .filter((provider) => provider.isCustom)
    .map((provider) => ({ id: provider.id, label: provider.label }))

  return [...PROVIDER_SECTIONS, ...customProviderSections].flatMap((provider) => {
    if (!isProviderConfigured(provider.id, providersState)) {
      return []
    }

    const providerModels = modelCatalog.filter((model) => model.providerId === provider.id)
    const enabledProviderModels = providerModels.filter(
      (model) => modelToggleState[model.id] ?? model.enabledByDefault,
    )
    const sourceModels = enabledProviderModels.length > 0 ? enabledProviderModels : providerModels

    return sourceModels.map((model) => {
      const runtimeModelId = model.apiModelId ?? model.id
      const reasoningProfile = resolveModelReasoningProfile(model)
      return {
        defaultReasoningEffort: reasoningProfile?.defaultEffort,
        id: model.id,
        isCatalogBacked: true,
        label: model.label,
        providerId: provider.id,
        providerLabel: provider.label,
        reasoningCapable: reasoningProfile !== null,
        reasoningEfforts: reasoningProfile?.efforts,
        runtimeModelId,
      }
    })
  })
}

function getProviderLabel(providerId: ChatProviderId | null, providersState: ProvidersState | null) {
  if (!providerId) {
    return 'Saved model'
  }
  return (
    PROVIDER_SECTIONS.find((provider) => provider.id === providerId)?.label ??
    providersState?.apiKeyProviders.find((provider) => provider.id === providerId)?.label ??
    'Saved model'
  )
}

interface UseChatRuntimeConfigInput {
  activeChatMode: ChatMode
  isProvidersLoading: boolean
  providersState: ProvidersState | null
  settings: Pick<
    AppSettings,
    | 'agentModelId'
    | 'agentModelLabel'
    | 'agentModelProviderId'
    | 'chatModelId'
    | 'chatModelLabel'
    | 'chatModelProviderId'
    | 'chatReasoningEffort'
    | 'planModelId'
    | 'planModelLabel'
    | 'planModelProviderId'
  >
  updateSettings: (input: Partial<AppSettings>) => Promise<AppSettings | null>
}

function findSelectedModel(
  options: readonly ChatModelOption[],
  selection: {
    modelId: string
    providerId: ChatProviderId | null
  },
): ChatModelOption | null {
  const normalizedModelId = selection.modelId.trim()
  if (normalizedModelId.length === 0) {
    return options[0] ?? null
  }

  if (selection.providerId) {
    const sameProviderModel = options.find(
      (option) => option.id === normalizedModelId && option.providerId === selection.providerId,
    )
    if (sameProviderModel) {
      return sameProviderModel
    }
  }

  return options.find((option) => option.id === normalizedModelId) ?? options[0] ?? null
}

function findExactSelectedModel(
  options: readonly ChatModelOption[],
  selection: {
    modelId: string
    providerId: ChatProviderId | null
  },
): ChatModelOption | null {
  const normalizedModelId = selection.modelId.trim()
  if (normalizedModelId.length === 0) {
    return null
  }

  if (selection.providerId) {
    return options.find((option) => option.id === normalizedModelId && option.providerId === selection.providerId) ?? null
  }

  return options.find((option) => option.id === normalizedModelId) ?? null
}

function toStaticChatModelOption(model: ModelCatalogItem): ChatModelOption {
  const runtimeModelId = model.apiModelId ?? model.id
  const reasoningProfile = resolveModelReasoningProfile(model)
  return {
    defaultReasoningEffort: reasoningProfile?.defaultEffort,
    id: model.id,
    isCatalogBacked: true,
    label: model.label,
    providerId: model.providerId,
    providerLabel: PROVIDER_SECTIONS.find((provider) => provider.id === model.providerId)?.label ?? 'Saved model',
    reasoningCapable: reasoningProfile !== null,
    reasoningEfforts: reasoningProfile?.efforts ?? model.reasoningEfforts,
    runtimeModelId,
  }
}

function getModeSelectionFields(
  activeChatMode: ChatMode,
  settings: Pick<
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
  >,
) {
  if (activeChatMode === 'plan') {
    return {
      modelId: settings.planModelId.trim().length > 0 ? settings.planModelId : settings.chatModelId,
      modelLabel: settings.planModelLabel.trim().length > 0 ? settings.planModelLabel : settings.chatModelLabel,
      providerId: settings.planModelProviderId ?? settings.chatModelProviderId,
      updateKeys: {
        modelId: 'planModelId',
        modelLabel: 'planModelLabel',
        providerId: 'planModelProviderId',
      } as const,
    }
  }

  return {
    modelId: settings.agentModelId.trim().length > 0 ? settings.agentModelId : settings.chatModelId,
    modelLabel: settings.agentModelLabel.trim().length > 0 ? settings.agentModelLabel : settings.chatModelLabel,
    providerId: settings.agentModelProviderId ?? settings.chatModelProviderId,
    updateKeys: {
      modelId: 'agentModelId',
      modelLabel: 'agentModelLabel',
      providerId: 'agentModelProviderId',
    } as const,
  }
}

export function useChatRuntimeConfig({
  activeChatMode,
  isProvidersLoading,
  providersState,
  settings,
  updateSettings,
}: UseChatRuntimeConfigInput) {
  const { customModels, customModelsLoading, providerModels, providerModelsLoading } = useSettingsModelCatalog(providersState)
  const allModelCatalog = useMemo(
    () => dedupeModelCatalogItems([
      ...MODEL_CATALOG,
      ...toProviderModelCatalogItems(providerModels),
      ...toCustomModelCatalogItems(customModels),
    ]),
    [customModels, providerModels],
  )
  const enabledStaticModelOptions = useMemo(
    () => filterEnabledModelCatalogItems(MODEL_CATALOG).map(toStaticChatModelOption),
    [],
  )
  const modelOptions = useMemo(
    () => buildChatModelOptions(providersState, customModels, providerModels),
    [customModels, providerModels, providersState],
  )
  const modeSelection = useMemo(
    () => getModeSelectionFields(activeChatMode, settings),
    [activeChatMode, settings],
  )
  const selectedProviderConfigured = useMemo(() => {
    if (modeSelection.providerId === null) {
      return false
    }

    return isProviderConfigured(modeSelection.providerId, providersState)
  }, [modeSelection.providerId, providersState])
  const missingSelectedModelOption = useMemo(() => {
    const normalizedSavedModelId = modeSelection.modelId.trim()
    const hasExactEnabledCatalogMatch = modelOptions.some((option) => {
      if (option.id !== normalizedSavedModelId) {
        return false
      }

      if (modeSelection.providerId === null) {
        return true
      }

      return option.providerId === modeSelection.providerId
    })

    const hasExactCatalogMatch = allModelCatalog.some((option) => {
      if (option.id !== normalizedSavedModelId) {
        return false
      }

      if (modeSelection.providerId === null) {
        return true
      }

      return option.providerId === modeSelection.providerId
    })

    if (
      normalizedSavedModelId.length === 0 ||
      hasExactEnabledCatalogMatch ||
      (hasExactCatalogMatch && selectedProviderConfigured)
    ) {
      return null
    }

    const fallbackProviderLabel =
      modeSelection.providerId === null
        ? 'Saved model'
        : getProviderLabel(modeSelection.providerId, providersState)
    const fallbackLabel = modeSelection.modelLabel.trim().length > 0 ? modeSelection.modelLabel.trim() : normalizedSavedModelId

    return {
      id: normalizedSavedModelId,
      isCatalogBacked: false,
      label: fallbackLabel,
      providerId: modeSelection.providerId,
      providerLabel: fallbackProviderLabel,
      reasoningCapable: false,
      runtimeModelId: normalizedSavedModelId,
    } satisfies ChatModelOption
  }, [
    allModelCatalog,
    modeSelection.modelId,
    modeSelection.modelLabel,
    modeSelection.providerId,
    modelOptions,
    selectedProviderConfigured,
    providersState,
  ])
  const runtimeModelOptions = useMemo(
    () => (missingSelectedModelOption ? [missingSelectedModelOption, ...modelOptions] : modelOptions),
    [missingSelectedModelOption, modelOptions],
  )

  const selectedModel = useMemo(() => {
    const selectedModelSelection = {
      modelId: modeSelection.modelId,
      providerId: modeSelection.providerId,
    }

    const exactRuntimeModel = findExactSelectedModel(runtimeModelOptions, selectedModelSelection)
    const exactStaticModel = findExactSelectedModel(enabledStaticModelOptions, selectedModelSelection)

    if (exactStaticModel) {
      return exactStaticModel
    }

    return exactRuntimeModel ?? findSelectedModel(runtimeModelOptions, selectedModelSelection)
  }, [enabledStaticModelOptions, modeSelection.modelId, modeSelection.providerId, runtimeModelOptions])
  const availableReasoningEfforts = useMemo(() => {
    if (!selectedModel?.reasoningCapable) {
      return [] as readonly ReasoningEffort[]
    }

    return selectedModel.reasoningEfforts ?? []
  }, [selectedModel])
  const reasoningEffort = useMemo(
    () => availableReasoningEfforts.includes(settings.chatReasoningEffort)
      ? settings.chatReasoningEffort
      : selectedModel?.defaultReasoningEffort ?? normalizeReasoningEffort(settings.chatReasoningEffort, availableReasoningEfforts),
    [availableReasoningEfforts, selectedModel?.defaultReasoningEffort, settings.chatReasoningEffort],
  )
  const hasSavedModelId = modeSelection.modelId.trim().length > 0
  const isModelOptionsLoading =
    !hasSavedModelId && (isProvidersLoading || customModelsLoading || providerModelsLoading)

  useEffect(() => {
    if (modeSelection.modelId.trim().length > 0) {
      return
    }

    const nextModel = modelOptions[0]
    if (!nextModel) {
      return
    }

    void updateSettings({
      [modeSelection.updateKeys.modelId]: nextModel.id,
      [modeSelection.updateKeys.providerId]: nextModel.providerId,
      [modeSelection.updateKeys.modelLabel]: nextModel.label,
      chatModelId: nextModel.id,
      chatModelProviderId: nextModel.providerId,
      chatModelLabel: nextModel.label,
    })
  }, [
    modelOptions,
    modeSelection.modelId,
    modeSelection.updateKeys.modelId,
    modeSelection.updateKeys.modelLabel,
    modeSelection.updateKeys.providerId,
    updateSettings,
  ])

  useEffect(() => {
    const normalizedSavedModelId = modeSelection.modelId.trim()
    if (normalizedSavedModelId.length === 0) {
      return
    }

    const hasEnabledSelection = modelOptions.some((option) => {
      if (option.id !== normalizedSavedModelId) {
        return false
      }

      if (modeSelection.providerId === null) {
        return true
      }

      return option.providerId === modeSelection.providerId
    })

    if (hasEnabledSelection) {
      return
    }

    const hasKnownSelection = selectedProviderConfigured && allModelCatalog.some((option) => {
      if (option.id !== normalizedSavedModelId) {
        return false
      }

      if (modeSelection.providerId === null) {
        return true
      }

      return option.providerId === modeSelection.providerId
    })

    if (!hasKnownSelection) {
      return
    }

    const nextModel = modelOptions[0]
    if (!nextModel) {
      return
    }

    void updateSettings({
      [modeSelection.updateKeys.modelId]: nextModel.id,
      [modeSelection.updateKeys.providerId]: nextModel.providerId,
      [modeSelection.updateKeys.modelLabel]: nextModel.label,
      chatModelId: nextModel.id,
      chatModelProviderId: nextModel.providerId,
      chatModelLabel: nextModel.label,
    })
  }, [
    allModelCatalog,
    modelOptions,
    modeSelection.modelId,
    modeSelection.providerId,
    modeSelection.updateKeys.modelId,
    modeSelection.updateKeys.modelLabel,
    modeSelection.updateKeys.providerId,
    selectedProviderConfigured,
    updateSettings,
  ])

  useEffect(() => {
    if (!selectedModel?.isCatalogBacked) {
      return
    }

    if (modeSelection.providerId === selectedModel.providerId) {
      return
    }

    void updateSettings({
      [modeSelection.updateKeys.providerId]: selectedModel.providerId,
      chatModelProviderId: selectedModel.providerId,
    })
  }, [modeSelection.providerId, modeSelection.updateKeys.providerId, selectedModel, updateSettings])

  useEffect(() => {
    if (!selectedModel?.isCatalogBacked) {
      return
    }

    if (availableReasoningEfforts.length === 0 || reasoningEffort === settings.chatReasoningEffort) {
      return
    }

    void updateSettings({ chatReasoningEffort: reasoningEffort })
  }, [
    availableReasoningEfforts.length,
    reasoningEffort,
    selectedModel,
    settings.chatReasoningEffort,
    updateSettings,
  ])

  const setSelectedModelId = useCallback(
    (chatModelId: string) => {
      const selectedOption = runtimeModelOptions.find((option) => option.id === chatModelId) ?? null
      const nextProviderId = selectedOption?.providerId ?? null
      if (chatModelId === modeSelection.modelId && nextProviderId === modeSelection.providerId) {
        return
      }

      void updateSettings({
        [modeSelection.updateKeys.modelId]: chatModelId,
        [modeSelection.updateKeys.providerId]: nextProviderId,
        [modeSelection.updateKeys.modelLabel]: selectedOption?.label ?? chatModelId,
        chatModelId,
        chatModelProviderId: nextProviderId,
        chatModelLabel: selectedOption?.label ?? chatModelId,
      })
    },
    [
      modeSelection.modelId,
      modeSelection.providerId,
      modeSelection.updateKeys.modelId,
      modeSelection.updateKeys.modelLabel,
      modeSelection.updateKeys.providerId,
      runtimeModelOptions,
      updateSettings,
    ],
  )

  const setReasoningEffort = useCallback(
    (chatReasoningEffort: ReasoningEffort) => {
      if (chatReasoningEffort === settings.chatReasoningEffort) {
        return
      }

      void updateSettings({ chatReasoningEffort })
    },
    [settings.chatReasoningEffort, updateSettings],
  )

  return {
    availableReasoningEfforts,
    hasConfiguredProvider: modelOptions.length > 0,
    isModelOptionsLoading,
    modelOptions: runtimeModelOptions,
    providerId: selectedModel?.providerId ?? null,
    providerLabel: selectedModel?.providerLabel ?? null,
    reasoningEffort,
    selectedModelId: selectedModel?.id ?? modeSelection.modelId,
    selectedRuntimeModelId: selectedModel?.runtimeModelId ?? modeSelection.modelId,
    setReasoningEffort,
    setSelectedModelId,
    showReasoningEffortSelector: availableReasoningEfforts.length > 0,
  }
}

export type ChatRuntimeConfigState = ReturnType<typeof useChatRuntimeConfig>
