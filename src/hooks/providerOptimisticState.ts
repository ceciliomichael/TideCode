import type {
  ApiKeyProviderId,
  ApiKeyProviderStatus,
  ProvidersState,
  SaveApiKeyProviderInput,
} from '../types/chat'

function isCustomProviderId(providerId: ApiKeyProviderId) {
  return providerId.startsWith('custom:')
}

export function applyOptimisticProviderSave(
  providersState: ProvidersState | null,
  input: SaveApiKeyProviderInput,
): ProvidersState | null {
  if (!providersState) return null

  const existing = providersState.apiKeyProviders.find((provider) => provider.id === input.providerId)
  const isCustom = isCustomProviderId(input.providerId)
  const nextStatus: ApiKeyProviderStatus = {
    apiKey: null,
    baseUrl: input.baseUrl?.trim() || existing?.baseUrl || null,
    configured: true,
    extraBody: input.extraBody?.trim() ?? existing?.extraBody ?? '',
    hasApiKey: Boolean(input.apiKey.trim()) || existing?.hasApiKey === true,
    id: input.providerId,
    isCustom,
    label: isCustom ? input.label?.trim() || existing?.label || 'Custom provider' : existing?.label ?? input.providerId,
    models: existing?.models ?? [],
  }

  const providerExists = providersState.apiKeyProviders.some((provider) => provider.id === input.providerId)
  return {
    ...providersState,
    apiKeyProviders: providerExists
      ? providersState.apiKeyProviders.map((provider) => (provider.id === input.providerId ? nextStatus : provider))
      : [...providersState.apiKeyProviders, nextStatus],
  }
}

export function applyOptimisticProviderRemoval(
  providersState: ProvidersState | null,
  providerId: ApiKeyProviderId,
): ProvidersState | null {
  if (!providersState) return null

  if (isCustomProviderId(providerId)) {
    return {
      ...providersState,
      apiKeyProviders: providersState.apiKeyProviders.filter((provider) => provider.id !== providerId),
    }
  }

  return {
    ...providersState,
    apiKeyProviders: providersState.apiKeyProviders.map((provider) =>
      provider.id === providerId
        ? {
            ...provider,
            apiKey: null,
            baseUrl: null,
            configured: false,
            extraBody: '',
            hasApiKey: false,
            models: [],
          }
        : provider,
    ),
  }
}
