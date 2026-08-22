import { useCallback, useEffect, useMemo } from 'react'
import { MODEL_CATALOG, PROVIDER_SECTIONS } from '../components/settings/models/modelCatalog'
import { useSettingsModelCatalog } from '../components/settings/models/settingsModelCatalogStore'
import { toCustomModelCatalogItems } from '../components/settings/models/customModelUtils'
import { toProviderModelCatalogItems } from '../components/settings/models/providerModelUtils'
import { dedupeModelCatalogItems } from '../components/settings/models/modelCatalogDedupe'
import { filterEnabledModelCatalogItems, readStoredModelToggleState } from '../components/settings/models/modelStorage'
import { isProviderConfigured } from '../components/settings/models/modelViewUtils'
import { resolveModelReasoningProfile } from '../lib/modelReasoningProfiles'
import { resolveReasoningEffortTransition } from '../lib/reasoningEffortTransition'
import { getRendererAppSettingsSurface } from '../lib/appSettingsScopes'
import { buildSurfaceModelSelectionSettingsPatch, resolveSurfaceModeModelSelection } from '../lib/surfaceModelSettings'
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
    ...toCustomModelCatalogItems(customModels),
    ...toProviderModelCatalogItems(providerModels),
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
  activeConversationId: string | null
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

export function useChatRuntimeConfig({
  activeChatMode,
  activeConversationId,
  isProvidersLoading,
  providersState,
  settings,
  updateSettings,
}: UseChatRuntimeConfigInput) {
  const runtimeSurface = getRendererAppSettingsSurface()
  const { customModels, customModelsLoading, providerModels, providerModelsLoading } = useSettingsModelCatalog(providersState)
  const allModelCatalog = useMemo(
    () => dedupeModelCatalogItems([
      ...MODEL_CATALOG,
      ...toCustomModelCatalogItems(customModels),
      ...toProviderModelCatalogItems(providerModels),
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
    () => resolveSurfaceModeModelSelection(activeChatMode, settings),
    [activeChatMode, settings],
  )
  const effectiveModeSelection = modeSelection
  const selectedProviderConfigured = useMemo(() => {
    if (effectiveModeSelection.providerId === null) {
      return false
    }

    return isProviderConfigured(effectiveModeSelection.providerId, providersState)
  }, [effectiveModeSelection.providerId, providersState])
  const missingSelectedModelOption = useMemo<ChatModelOption | null>(() => {
    const normalizedSavedModelId = effectiveModeSelection.modelId.trim()
    const hasExactEnabledCatalogMatch = modelOptions.some((option) => {
      if (option.id !== normalizedSavedModelId) {
        return false
      }

      if (effectiveModeSelection.providerId === null) {
        return true
      }

      return option.providerId === effectiveModeSelection.providerId
    })

    const hasExactCatalogMatch = allModelCatalog.some((option) => {
      if (option.id !== normalizedSavedModelId) {
        return false
      }

      if (effectiveModeSelection.providerId === null) {
        return true
      }

      return option.providerId === effectiveModeSelection.providerId
    })

    if (
      normalizedSavedModelId.length === 0 ||
      hasExactEnabledCatalogMatch ||
      (hasExactCatalogMatch && selectedProviderConfigured)
    ) {
      return null
    }

    const fallbackProviderLabel =
      effectiveModeSelection.providerId === null
        ? 'Saved model'
        : getProviderLabel(effectiveModeSelection.providerId, providersState)
    const fallbackLabel = effectiveModeSelection.modelLabel.trim().length > 0 ? effectiveModeSelection.modelLabel.trim() : normalizedSavedModelId

    return {
      id: normalizedSavedModelId,
      isCatalogBacked: false,
      label: fallbackLabel,
      providerId: effectiveModeSelection.providerId,
      providerLabel: fallbackProviderLabel,
      reasoningCapable: false,
      runtimeModelId: normalizedSavedModelId,
    } satisfies ChatModelOption
  }, [
    allModelCatalog,
    effectiveModeSelection.modelId,
    effectiveModeSelection.modelLabel,
    effectiveModeSelection.providerId,
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
      modelId: effectiveModeSelection.modelId,
      providerId: effectiveModeSelection.providerId,
    }

    const exactRuntimeModel = findExactSelectedModel(runtimeModelOptions, selectedModelSelection)
    const exactStaticModel = findExactSelectedModel(enabledStaticModelOptions, selectedModelSelection)

    if (exactStaticModel) {
      return exactStaticModel
    }

    return exactRuntimeModel ?? findSelectedModel(runtimeModelOptions, selectedModelSelection)
  }, [enabledStaticModelOptions, effectiveModeSelection.modelId, effectiveModeSelection.providerId, runtimeModelOptions])
  const availableReasoningEfforts = useMemo(() => {
    if (!selectedModel?.reasoningCapable) {
      return [] as readonly ReasoningEffort[]
    }

    return selectedModel.reasoningEfforts ?? []
  }, [selectedModel])
  const reasoningEffort = useMemo(
    () => resolveReasoningEffortTransition({
      currentEffort: settings.chatReasoningEffort,
      defaultEffort: selectedModel?.defaultReasoningEffort,
      supportedEfforts: availableReasoningEfforts,
    }),
    [availableReasoningEfforts, selectedModel?.defaultReasoningEffort, settings.chatReasoningEffort],
  )
  const effectiveReasoningEffort = reasoningEffort
  const hasSavedModelId = effectiveModeSelection.modelId.trim().length > 0
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

    if (availableReasoningEfforts.length === 0 || effectiveReasoningEffort === settings.chatReasoningEffort) {
      return
    }

    void updateSettings({ chatReasoningEffort: effectiveReasoningEffort })
  }, [
    availableReasoningEfforts.length,
    effectiveReasoningEffort,
    selectedModel,
    settings.chatReasoningEffort,
    updateSettings,
  ])

  const setSelectedModelId = useCallback(
    (chatModelId: string) => {
      const selectedOption = runtimeModelOptions.find((option) => option.id === chatModelId) ?? null
      const nextProviderId = selectedOption?.providerId ?? null
      if (chatModelId === effectiveModeSelection.modelId && nextProviderId === effectiveModeSelection.providerId) {
        return
      }

      const nextReasoningEffort = resolveReasoningEffortTransition({
        currentEffort: settings.chatReasoningEffort,
        defaultEffort: selectedOption?.defaultReasoningEffort,
        supportedEfforts: selectedOption?.reasoningEfforts,
      })

      const modelLabel = selectedOption?.label ?? chatModelId
      const sharedModel = {
        label: modelLabel,
        modelId: chatModelId,
        providerId: nextProviderId,
        reasoningEffort: nextReasoningEffort,
        runtimeModelId: selectedOption?.runtimeModelId ?? chatModelId,
      }

      void updateSettings(buildSurfaceModelSelectionSettingsPatch(activeChatMode, {
        modelId: chatModelId,
        modelLabel,
        providerId: nextProviderId,
        reasoningEffort: nextReasoningEffort,
      }))

      if (activeConversationId) {
        void window.tidecodeRuns.updateConversationRuntime({
          chatMode: activeChatMode,
          conversationId: activeConversationId,
          model: sharedModel,
          surface: runtimeSurface,
        }).catch((error) => {
          console.error('Failed to sync conversation model', error)
        })
      }
    },
    [
      activeChatMode,
      activeConversationId,
      effectiveModeSelection.modelId,
      effectiveModeSelection.providerId,
      runtimeModelOptions,
      runtimeSurface,
      settings.chatReasoningEffort,
      updateSettings,
    ],
  )

  const setReasoningEffort = useCallback(
    (chatReasoningEffort: ReasoningEffort) => {
      if (chatReasoningEffort === effectiveReasoningEffort) {
        return
      }

      void updateSettings({ chatReasoningEffort })

      if (activeConversationId) {
        const sharedModel = {
          label: selectedModel?.label ?? (effectiveModeSelection.modelLabel.trim() || effectiveModeSelection.modelId),
          modelId: effectiveModeSelection.modelId,
          providerId: effectiveModeSelection.providerId,
          reasoningEffort: chatReasoningEffort,
          runtimeModelId: selectedModel?.runtimeModelId ?? effectiveModeSelection.modelId,
        }
        void window.tidecodeRuns.updateConversationRuntime({
          chatMode: activeChatMode,
          conversationId: activeConversationId,
          model: sharedModel,
          surface: runtimeSurface,
        }).catch((error) => {
          console.error('Failed to sync conversation reasoning effort', error)
        })
      }
    },
    [
      activeChatMode,
      activeConversationId,
      effectiveModeSelection.modelId,
      effectiveModeSelection.modelLabel,
      effectiveModeSelection.providerId,
      effectiveReasoningEffort,
      selectedModel?.label,
      selectedModel?.runtimeModelId,
      runtimeSurface,
      updateSettings,
    ],
  )

  return {
    availableReasoningEfforts,
    hasConfiguredProvider: modelOptions.length > 0,
    isModelOptionsLoading,
    modelOptions: runtimeModelOptions,
    providerId: selectedModel?.providerId ?? null,
    providerLabel: selectedModel?.providerLabel ?? null,
    reasoningEffort: effectiveReasoningEffort,
    selectedModelId: selectedModel?.id ?? effectiveModeSelection.modelId,
    selectedRuntimeModelId: selectedModel?.runtimeModelId ?? effectiveModeSelection.modelId,
    setReasoningEffort,
    setSelectedModelId,
    showReasoningEffortSelector: availableReasoningEfforts.length > 0,
  }
}

export type ChatRuntimeConfigState = ReturnType<typeof useChatRuntimeConfig>
