import type { ApiKeyProviderId, BuiltInApiKeyProviderId, ChatProviderId, CustomApiKeyProviderId } from '../../src/types/chat'

export const BUILT_IN_API_KEY_PROVIDER_IDS = [
  'openai',
  'anthropic',
  'google',
  'mistral',
  'deepseek',
] as const satisfies readonly BuiltInApiKeyProviderId[]

export function isBuiltInApiKeyProviderId(value: unknown): value is BuiltInApiKeyProviderId {
  return typeof value === 'string' && BUILT_IN_API_KEY_PROVIDER_IDS.some((providerId) => providerId === value)
}

export function isCustomApiKeyProviderId(value: unknown): value is CustomApiKeyProviderId {
  return typeof value === 'string' && value.startsWith('custom:') && value.trim().length > 7
}

export function isApiKeyProviderId(value: unknown): value is ApiKeyProviderId {
  return isBuiltInApiKeyProviderId(value) || isCustomApiKeyProviderId(value)
}

export function apiKeyProviderUsesCustomBaseUrl(providerId: ApiKeyProviderId) {
  return isCustomApiKeyProviderId(providerId)
}

export function isChatProviderId(value: unknown): value is ChatProviderId {
  return value === 'codex' || isApiKeyProviderId(value)
}
