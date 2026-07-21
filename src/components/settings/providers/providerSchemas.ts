import type { ApiKeyProviderId, BuiltInApiKeyProviderId } from '../../../types/chat'

export interface ApiKeyProviderSchema<TProviderId extends ApiKeyProviderId = BuiltInApiKeyProviderId> {
  apiKeyOptional: boolean
  baseUrlRequired: boolean
  defaultBaseUrl: string
  description: string
  id: TProviderId
  label: string
  showBaseUrl: boolean
}

export const API_KEY_PROVIDER_SCHEMAS: readonly ApiKeyProviderSchema[] = [
  {
    apiKeyOptional: false,
    baseUrlRequired: false,
    defaultBaseUrl: 'https://api.openai.com/v1',
    description: 'Bring your OpenAI models into Echosphere.',
    id: 'openai',
    label: 'OpenAI',
    showBaseUrl: false,
  },
  {
    apiKeyOptional: false,
    baseUrlRequired: false,
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    description: 'Chat and build with Claude models.',
    id: 'anthropic',
    label: 'Anthropic',
    showBaseUrl: false,
  },
  {
    apiKeyOptional: false,
    baseUrlRequired: false,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    description: 'Use Gemini models for everyday and complex work.',
    id: 'google',
    label: 'Google',
    showBaseUrl: false,
  },
  {
    apiKeyOptional: false,
    baseUrlRequired: false,
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    description: 'Connect Mistral models for fast, capable assistance.',
    id: 'mistral',
    label: 'Mistral AI',
    showBaseUrl: false,
  },
  {
    apiKeyOptional: false,
    baseUrlRequired: false,
    defaultBaseUrl: 'https://api.deepseek.com',
    description: 'Use DeepSeek V4 with thinking ready by default.',
    id: 'deepseek',
    label: 'DeepSeek',
    showBaseUrl: false,
  },
] as const

export function getApiKeyProviderSchema(providerId: BuiltInApiKeyProviderId) {
  return API_KEY_PROVIDER_SCHEMAS.find((schema) => schema.id === providerId)
}
