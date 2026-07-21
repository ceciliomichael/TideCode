import { MODEL_CATALOG, PROVIDER_SECTIONS } from './modelCatalog'
import type { ModelCatalogItem } from './modelTypes'
import { toCustomModelCatalogItems } from './customModelUtils'
import { toProviderModelCatalogItems } from './providerModelUtils'
import type { ChatProviderId, CustomModelConfig, ProviderModelConfig, ProvidersState } from '../../../types/chat'
import { dedupeModelCatalogItems } from './modelCatalogDedupe'

export interface ModelProviderSectionView {
  configured: boolean
  models: ModelCatalogItem[]
  provider: { description: string; id: ChatProviderId; label: string }
}

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase()
}

export function isProviderConfigured(providerId: ChatProviderId, providersState: ProvidersState | null) {
  if (!providersState) {
    return false
  }

  if (providerId === 'codex') {
    return providersState.codex.isAuthenticated
  }

  const providerStatus = providersState.apiKeyProviders.find((provider) => provider.id === providerId)
  return Boolean(providerStatus?.configured)
}

export function buildModelProviderSections(
  searchValue: string,
  providersState: ProvidersState | null,
  customModels: readonly CustomModelConfig[],
  providerModels: readonly ProviderModelConfig[] = [],
): ModelProviderSectionView[] {
  const normalizedSearch = normalizeSearchValue(searchValue)
  const modelCatalog = dedupeModelCatalogItems([
    ...MODEL_CATALOG,
    ...toProviderModelCatalogItems(providerModels),
    ...toCustomModelCatalogItems(customModels),
  ])
  const filteredModels =
    normalizedSearch.length === 0
      ? modelCatalog
      : modelCatalog.filter((model) => model.label.toLowerCase().includes(normalizedSearch))

  const customProviderSections = (providersState?.apiKeyProviders ?? [])
    .filter((provider) => provider.isCustom)
    .map((provider) => ({
      description: 'Models from your connected service.',
      id: provider.id,
      label: provider.label,
    }))

  return [...PROVIDER_SECTIONS, ...customProviderSections].map((provider) => ({
    configured: isProviderConfigured(provider.id, providersState),
    models: filteredModels.filter((model) => model.providerId === provider.id),
    provider,
  })).filter((section) => section.configured && section.models.length > 0)
}
