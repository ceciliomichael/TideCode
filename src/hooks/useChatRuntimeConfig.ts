import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { resolveConversationModelSelection, resolveSurfaceModeModelSelection } from '../lib/surfaceModelSettings'
import type {
  AppSettings,
  ChatMode,
  ChatProviderId,
  CustomModelConfig,
  Message,
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
  activeMessages: readonly Message[]
  isProvidersLoading: boolean
  providersState: ProvidersState | null
  settings: Pick<
    AppSettings,
    | 'agentModelId'
    | 'agentModelLabel'
    | 'agentModelProviderId'
    | 'agentReasoningEffort'
    | 'chatModelId'
    | 'chatModelLabel'
    | 'chatModelProviderId'
    | 'chatReasoningEffort'
    | 'conversationModelPreferences'
    | 'planModelId'
    | 'planModelLabel'
    | 'planModelProviderId'
    | 'planReasoningEffort'
  >
  updateSettings: (input: Partial<AppSettings>) => Promise<AppSettings | null>
}

function matchesModelId(option: ChatModelOption, modelId: string) {
  return option.id === modelId || option.runtimeModelId === modelId
}

function matchesCatalogModelId(option: ModelCatalogItem, modelId: string) {
  return option.id === modelId || option.apiModelId === modelId
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
      (option) => matchesModelId(option, normalizedModelId) && option.providerId === selection.providerId,
    )
    if (sameProviderModel) {
      return sameProviderModel
    }
  }

  return options.find((option) => matchesModelId(option, normalizedModelId)) ?? options[0] ?? null
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
    return options.find(
      (option) => matchesModelId(option, normalizedModelId) && option.providerId === selection.providerId,
    ) ?? null
  }

  return options.find((option) => matchesModelId(option, normalizedModelId)) ?? null
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
  activeMessages,
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
  type SelectionOverride = {
    conversationId: string | null
    modelId: string
    modelLabel: string
    providerId: ChatProviderId | null
    reasoningEffort: ReasoningEffort
  }
  const [selectionOverrides, setSelectionOverrides] = useState<{
    conversationId: string | null
    byMode: Partial<Record<ChatMode, SelectionOverride>>
  }>({ conversationId: activeConversationId, byMode: {} })
  const modeSelection = useMemo(
    () => resolveSurfaceModeModelSelection(activeChatMode, settings),
    [activeChatMode, settings],
  )
  const latestUserMessage = useMemo(
    () => [...activeMessages].reverse().find(
      (message) => message.role === 'user' && (message.chatMode === undefined || message.chatMode === activeChatMode),
    ) ?? null,
    [activeChatMode, activeMessages],
  )
  const conversationSelection = useMemo(
    () => resolveConversationModelSelection(
      activeChatMode,
      modeSelection,
      activeConversationId ? settings.conversationModelPreferences[activeConversationId] : null,
      activeConversationId ? latestUserMessage : null,
    ),
    [
      activeChatMode,
      activeConversationId,
      latestUserMessage,
      modeSelection,
      settings.conversationModelPreferences,
    ],
  )
  const effectiveModeSelection = useMemo(() => {
    const selectionOverride = selectionOverrides.conversationId === activeConversationId
      ? selectionOverrides.byMode[activeChatMode]
      : undefined
    if (
      selectionOverride?.conversationId === activeConversationId
    ) {
      return {
        ...conversationSelection,
        modelId: selectionOverride.modelId,
        modelLabel: selectionOverride.modelLabel,
        providerId: selectionOverride.providerId,
        reasoningEffort: selectionOverride.reasoningEffort,
      }
    }

    return conversationSelection
  }, [activeChatMode, activeConversationId, conversationSelection, selectionOverrides])

  useEffect(() => {
    setSelectionOverrides({ conversationId: activeConversationId, byMode: {} })
  }, [activeConversationId])

  const selectedProviderConfigured = useMemo(() => {
    if (effectiveModeSelection.providerId === null) {
      return false
    }

    return isProviderConfigured(effectiveModeSelection.providerId, providersState)
  }, [effectiveModeSelection.providerId, providersState])
  const modeProviderConfigured = useMemo(() => {
    if (modeSelection.providerId === null) {
      return false
    }

    return isProviderConfigured(modeSelection.providerId, providersState)
  }, [modeSelection.providerId, providersState])
  const missingSelectedModelOption = useMemo<ChatModelOption | null>(() => {
    const normalizedSavedModelId = effectiveModeSelection.modelId.trim()
    const hasExactEnabledCatalogMatch = modelOptions.some((option) => {
      if (!matchesModelId(option, normalizedSavedModelId)) {
        return false
      }

      if (effectiveModeSelection.providerId === null) {
        return true
      }

      return option.providerId === effectiveModeSelection.providerId
    })

    const hasExactCatalogMatch = allModelCatalog.some((option) => {
      if (!matchesCatalogModelId(option, normalizedSavedModelId)) {
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
  const defaultSelectedModel = useMemo(() => {
    const selection = {
      modelId: modeSelection.modelId,
      providerId: modeSelection.providerId,
    }
    return findExactSelectedModel(modelOptions, selection) ?? findExactSelectedModel(enabledStaticModelOptions, selection)
  }, [enabledStaticModelOptions, modeSelection.modelId, modeSelection.providerId, modelOptions])
  const availableReasoningEfforts = useMemo(() => {
    if (!selectedModel?.reasoningCapable) {
      return [] as readonly ReasoningEffort[]
    }

    return selectedModel.reasoningEfforts ?? []
  }, [selectedModel])
  const reasoningEffort = useMemo(
    () => resolveReasoningEffortTransition({
      currentEffort: effectiveModeSelection.reasoningEffort ?? settings.chatReasoningEffort,
      defaultEffort: selectedModel?.defaultReasoningEffort,
      supportedEfforts: availableReasoningEfforts,
    }),
    [
      availableReasoningEfforts,
      effectiveModeSelection.reasoningEffort,
      selectedModel?.defaultReasoningEffort,
      settings.chatReasoningEffort,
    ],
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
      if (!matchesModelId(option, normalizedSavedModelId)) {
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

    const hasKnownSelection = modeProviderConfigured && allModelCatalog.some((option) => {
      if (!matchesCatalogModelId(option, normalizedSavedModelId)) {
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
    modeProviderConfigured,
    updateSettings,
  ])

  useEffect(() => {
    if (!defaultSelectedModel?.isCatalogBacked) {
      return
    }

    if (modeSelection.providerId === defaultSelectedModel.providerId) {
      return
    }

    void updateSettings({
      [modeSelection.updateKeys.providerId]: defaultSelectedModel.providerId,
      chatModelProviderId: defaultSelectedModel.providerId,
    })
  }, [defaultSelectedModel, modeSelection.providerId, modeSelection.updateKeys.providerId, updateSettings])

  const resolveDefaultRuntimeModel = useCallback(
    (chatMode: ChatMode) => {
      const defaultSelection = resolveSurfaceModeModelSelection(chatMode, settings)
      const catalogModel = allModelCatalog.find((option) => {
        if (!matchesCatalogModelId(option, defaultSelection.modelId)) {
          return false
        }
        return defaultSelection.providerId === null || option.providerId === defaultSelection.providerId
      })
      const selectedOption =
        findExactSelectedModel(modelOptions, defaultSelection) ??
        findExactSelectedModel(enabledStaticModelOptions, defaultSelection) ??
        (catalogModel ? toStaticChatModelOption(catalogModel) : null)
      const providerId = selectedOption?.providerId ?? defaultSelection.providerId
      const supportedEfforts = selectedOption?.reasoningCapable ? selectedOption.reasoningEfforts ?? [] : []
      const reasoningEffort = resolveReasoningEffortTransition({
        currentEffort: defaultSelection.reasoningEffort ?? settings.chatReasoningEffort,
        defaultEffort: selectedOption?.defaultReasoningEffort,
        supportedEfforts,
      })

      return {
        hasConfiguredProvider: modelOptions.length > 0,
        modelId: selectedOption?.runtimeModelId ?? defaultSelection.modelId,
        providerId,
        providerLabel: selectedOption?.providerLabel ?? (providerId ? getProviderLabel(providerId, providersState) : null),
        reasoningEffort,
      }
    },
    [allModelCatalog, enabledStaticModelOptions, modelOptions, providersState, settings],
  )

  const setSelectedModelId = useCallback(
    (chatModelId: string) => {
      const selectedOption = runtimeModelOptions.find((option) => option.id === chatModelId) ?? null
      const nextProviderId = selectedOption?.providerId ?? null
      if (chatModelId === effectiveModeSelection.modelId && nextProviderId === effectiveModeSelection.providerId) {
        return
      }

      const nextReasoningEffort = resolveReasoningEffortTransition({
        currentEffort: effectiveReasoningEffort,
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

      setSelectionOverrides((current) => ({
        conversationId: activeConversationId,
        byMode: {
          ...(current.conversationId === activeConversationId ? current.byMode : {}),
          [activeChatMode]: {
            conversationId: activeConversationId,
            modelId: chatModelId,
            modelLabel,
            providerId: nextProviderId,
            reasoningEffort: nextReasoningEffort,
          },
        },
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
      effectiveReasoningEffort,
      runtimeModelOptions,
      runtimeSurface,
    ],
  )

  const setReasoningEffort = useCallback(
    (chatReasoningEffort: ReasoningEffort) => {
      if (chatReasoningEffort === effectiveReasoningEffort) {
        return
      }

      setSelectionOverrides((current) => ({
        conversationId: activeConversationId,
        byMode: {
          ...(current.conversationId === activeConversationId ? current.byMode : {}),
          [activeChatMode]: {
            conversationId: activeConversationId,
            modelId: effectiveModeSelection.modelId,
            modelLabel: selectedModel?.label ?? (effectiveModeSelection.modelLabel.trim() || effectiveModeSelection.modelId),
            providerId: effectiveModeSelection.providerId,
            reasoningEffort: chatReasoningEffort,
          },
        },
      }))

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
    resolveDefaultRuntimeModel,
    selectedModelId: selectedModel?.id ?? effectiveModeSelection.modelId,
    selectedRuntimeModelId: selectedModel?.runtimeModelId ?? effectiveModeSelection.modelId,
    setReasoningEffort,
    setSelectedModelId,
    showReasoningEffortSelector: availableReasoningEfforts.length > 0,
  }
}

export type ChatRuntimeConfigState = ReturnType<typeof useChatRuntimeConfig>
