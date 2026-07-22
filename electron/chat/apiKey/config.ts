import type { ApiKeyProviderId, ConfigurableProviderModel } from '../../../src/types/chat'
import { apiKeyProviderUsesCustomBaseUrl, isApiKeyProviderId } from '../../providers/providerIds'
import { readStoredApiKeyProviders } from '../../providers/store'
import { listStoredCustomModels } from '../../models/store'

const DEFAULT_BASE_URLS: Partial<Record<ApiKeyProviderId, string>> = {
  anthropic: 'https://api.anthropic.com/v1',
  deepseek: 'https://api.deepseek.com',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  mistral: 'https://api.mistral.ai/v1',
  openai: 'https://api.openai.com/v1',
}

export interface ApiKeyChatProviderConfig {
  apiKey: string
  baseUrl: string
  extraBody: Record<string, unknown>
  models: ConfigurableProviderModel[]
  providerId: ApiKeyProviderId
}

export async function readApiKeyChatProviderConfig(providerId: ApiKeyProviderId): Promise<ApiKeyChatProviderConfig> {
  if (!isApiKeyProviderId(providerId)) {
    throw new Error('Unsupported API-key provider.')
  }

  const [providers, userModels] = await Promise.all([
    readStoredApiKeyProviders(),
    listStoredCustomModels(),
  ])
  const provider = providers[providerId]
  const usesCustomBaseUrl = apiKeyProviderUsesCustomBaseUrl(providerId)
  const baseUrl = usesCustomBaseUrl
    ? provider?.base_url?.trim() ?? ''
    : DEFAULT_BASE_URLS[providerId] ?? ''

  if (!provider?.api_key?.trim() && !usesCustomBaseUrl) {
    throw new Error(`Configure ${providerId} before using this provider.`)
  }
  if (!baseUrl) {
    throw new Error('Configure a base URL before using this OpenAI-compatible provider.')
  }

  return {
    apiKey: provider?.api_key?.trim() ?? '',
    baseUrl,
    extraBody: provider?.extra_body ?? {},
    models: [
      ...userModels
        .filter((model) => model.providerId === providerId)
        .map((model) => ({
          apiModelId: model.apiModelId,
          ...(model.defaultReasoningEffort ? { defaultReasoningEffort: model.defaultReasoningEffort } : {}),
          ...(model.extraBody ? { extraBody: model.extraBody } : {}),
          id: model.id,
          label: model.label,
          reasoningCapable: model.reasoningCapable,
          ...(model.reasoningBodies ? { reasoningBodies: model.reasoningBodies } : {}),
          ...(model.reasoningEfforts ? { reasoningEfforts: model.reasoningEfforts } : {}),
          ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
        })),
      ...(provider?.models ?? []),
    ],
    providerId,
  }
}
