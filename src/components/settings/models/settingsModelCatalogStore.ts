import { useEffect, useSyncExternalStore } from 'react'
import { toUserFacingErrorMessage } from '../../../lib/userFacingError'
import { isProviderConfigured } from './modelViewUtils'
import { PROVIDER_SECTIONS } from './modelCatalog'
import { mergeProviderModels } from './providerModelMergeUtils'
import type { ChatProviderId, CustomModelConfig, ProviderModelConfig, ProvidersState } from '../../../types/chat'

export interface SettingsModelCatalogState {
  customModels: CustomModelConfig[]
  customModelsErrorMessage: string | null
  customModelsHasLoaded: boolean
  customModelsLoading: boolean
  providerModels: ProviderModelConfig[]
  providerModelsErrorMessage: string | null
  providerModelsLoading: boolean
}

const EMPTY_SETTINGS_MODEL_CATALOG_STATE: SettingsModelCatalogState = {
  customModels: [],
  customModelsErrorMessage: null,
  customModelsHasLoaded: false,
  customModelsLoading: false,
  providerModels: [],
  providerModelsErrorMessage: null,
  providerModelsLoading: false,
}

const subscribers = new Set<() => void>()
let state: SettingsModelCatalogState = EMPTY_SETTINGS_MODEL_CATALOG_STATE
let customModelsRequest: Promise<CustomModelConfig[]> | null = null
const loadedProviderModelSignatures = new Map<ChatProviderId, string>()
const providerModelRequests = new Map<ChatProviderId, Promise<ProviderModelConfig[]>>()

function mergeCustomModels(
  existingModels: readonly CustomModelConfig[],
  incomingModels: readonly CustomModelConfig[],
): CustomModelConfig[] {
  const seenModelIds = new Set(existingModels.map((model) => model.id))
  const mergedModels = [...existingModels]

  for (const model of incomingModels) {
    if (seenModelIds.has(model.id)) {
      continue
    }

    seenModelIds.add(model.id)
    mergedModels.push(model)
  }

  return mergedModels.sort((left, right) => left.label.localeCompare(right.label))
}

function notifySubscribers() {
  for (const subscriber of subscribers) {
    subscriber()
  }
}

function updateState(nextState: SettingsModelCatalogState) {
  state = nextState
  notifySubscribers()
}

export function replaceCustomModels(customModels: readonly CustomModelConfig[]) {
  updateState({
    ...state,
    customModels: mergeCustomModels([], customModels),
    customModelsErrorMessage: null,
    customModelsHasLoaded: true,
    customModelsLoading: false,
  })
}

function setProviderModelsLoading() {
  updateState({
    ...state,
    providerModelsLoading: providerModelRequests.size > 0,
  })
}

function getConfiguredProviderIds(providersState: ProvidersState | null): ChatProviderId[] {
  if (!providersState) {
    return []
  }

  const builtInProviderIds = PROVIDER_SECTIONS.filter((provider) => isProviderConfigured(provider.id, providersState)).map(
    (provider) => provider.id,
  )
  const customProviderIds = providersState.apiKeyProviders
    .filter((provider) => provider.isCustom && provider.configured)
    .map((provider) => provider.id)
  return [...builtInProviderIds, ...customProviderIds]
}

function getLoadErrorMessage(error: unknown, fallbackMessage: string): string {
  return toUserFacingErrorMessage(error, fallbackMessage)
}

async function loadCustomModels() {
  if (typeof window === 'undefined') {
    return state.customModels
  }

  if (state.customModelsHasLoaded) {
    return state.customModels
  }

  if (customModelsRequest) {
    return customModelsRequest
  }

  updateState({
    ...state,
    customModelsErrorMessage: null,
    customModelsLoading: true,
  })

  customModelsRequest = window.tidecodeModels
    .listCustomModels()
    .then((models) => {
      updateState({
        ...state,
        customModels: mergeCustomModels(state.customModels, models),
        customModelsErrorMessage: null,
        customModelsHasLoaded: true,
        customModelsLoading: false,
      })
      return models
    })
    .catch((error) => {
      console.error('Failed to load custom models', error)
      updateState({
        ...state,
        customModelsErrorMessage: getLoadErrorMessage(error, 'Unable to load saved custom models.'),
        customModelsLoading: false,
      })
      return [] as CustomModelConfig[]
    })
    .finally(() => {
      customModelsRequest = null
    })

  return customModelsRequest
}

function getProviderModelSignature(providerId: ChatProviderId, providersState: ProvidersState) {
  if (providerId === 'codex') return 'codex:configured'
  const provider = providersState.apiKeyProviders.find((entry) => entry.id === providerId)
  return JSON.stringify(provider?.models ?? [])
}

function scheduleProviderModelsLoad(providerId: ChatProviderId, signature: string) {
  if (typeof window === 'undefined') {
    return Promise.resolve(state.providerModels)
  }

  const existingRequest = providerModelRequests.get(providerId)
  if (existingRequest) {
    return existingRequest
  }

  updateState({
    ...state,
    providerModelsErrorMessage: null,
    providerModelsLoading: true,
  })

  const request = window.tidecodeModels
    .listProviderModels(providerId)
    .then((models) => {
      loadedProviderModelSignatures.set(providerId, signature)
      updateState({
        ...state,
        providerModels: mergeProviderModels(
          state.providerModels.filter((model) => model.providerId !== providerId),
          models,
        ),
        providerModelsErrorMessage: null,
      })
      return models
    })
    .catch((error) => {
      console.error(`Failed to load ${providerId} models`, error)
      updateState({
        ...state,
        providerModelsErrorMessage: getLoadErrorMessage(error, 'Unable to load provider models.'),
      })
      return [] as ProviderModelConfig[]
    })
    .finally(() => {
      providerModelRequests.delete(providerId)
      setProviderModelsLoading()
    })

  providerModelRequests.set(providerId, request)
  return request
}

async function loadConfiguredProviderModels(providersState: ProvidersState | null) {
  if (typeof window === 'undefined') {
    return state.providerModels
  }

  if (!providersState) return state.providerModels
  const configuredProviderIds = getConfiguredProviderIds(providersState)
  const pendingProviderIds = configuredProviderIds.filter(
    (providerId) =>
      loadedProviderModelSignatures.get(providerId) !== getProviderModelSignature(providerId, providersState) &&
      !providerModelRequests.has(providerId),
  )

  if (pendingProviderIds.length === 0) {
    return state.providerModels
  }

  const loadOperations = pendingProviderIds.map((providerId) =>
    scheduleProviderModelsLoad(providerId, getProviderModelSignature(providerId, providersState)))
  await Promise.allSettled(loadOperations)
  return state.providerModels
}

export function getSettingsModelCatalogState() {
  return state
}

export function subscribeSettingsModelCatalog(listener: () => void) {
  subscribers.add(listener)
  return () => {
    subscribers.delete(listener)
  }
}

export async function preloadSettingsModelCatalog(providersState: ProvidersState | null) {
  const loadOperations: Promise<unknown>[] = [loadCustomModels()]

  loadOperations.push(loadConfiguredProviderModels(providersState))

  await Promise.allSettled(loadOperations)
}

export function useSettingsModelCatalog(providersState: ProvidersState | null) {
  const catalogState = useSyncExternalStore(
    subscribeSettingsModelCatalog,
    getSettingsModelCatalogState,
    getSettingsModelCatalogState,
  )

  useEffect(() => {
    void preloadSettingsModelCatalog(providersState)
  }, [providersState])

  return catalogState
}

export type SettingsModelCatalogStateSnapshot = ReturnType<typeof getSettingsModelCatalogState>
