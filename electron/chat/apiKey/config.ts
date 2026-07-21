import type { ApiKeyProviderId, ConfigurableProviderModel } from '../../../src/types/chat'
import { apiKeyProviderUsesCustomBaseUrl, isApiKeyProviderId } from '../../providers/providerIds'
import { readStoredApiKeyProviders } from '../../providers/store'

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

  const providers = await readStoredApiKeyProviders()
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
    models: provider?.models ?? [],
    providerId,
  }
}
