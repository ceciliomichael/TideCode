import type { BuiltInApiKeyProviderId } from '../../../types/chat'

export interface ApiKeyProviderSchema {
  apiKeyOptional: boolean
  baseUrlRequired: boolean
  defaultBaseUrl: string
  description: string
  extraBodyExample: string
  extraBodyHelp: string
  id: BuiltInApiKeyProviderId
  label: string
  showBaseUrl: boolean
}

export const API_KEY_PROVIDER_SCHEMAS: readonly ApiKeyProviderSchema[] = [
  {
    apiKeyOptional: false,
    baseUrlRequired: false,
    defaultBaseUrl: 'https://api.openai.com/v1',
    description: 'Bring your OpenAI models into Echosphere.',
    extraBodyExample: '{\n  "store": false\n}',
    extraBodyHelp: 'Add optional settings you want sent with each message.',
    id: 'openai',
    label: 'OpenAI',
    showBaseUrl: false,
  },
  {
    apiKeyOptional: false,
    baseUrlRequired: false,
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    description: 'Chat and build with Claude models.',
    extraBodyExample: '{\n  "metadata": {\n    "user_id": "local-user"\n  }\n}',
    extraBodyHelp: 'Add optional settings for your Claude messages.',
    id: 'anthropic',
    label: 'Anthropic',
    showBaseUrl: false,
  },
  {
    apiKeyOptional: false,
    baseUrlRequired: false,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    description: 'Use Gemini models for everyday and complex work.',
    extraBodyExample: '{\n  "generationConfig": {\n    "candidateCount": 1\n  }\n}',
    extraBodyHelp: 'Add optional settings for your Gemini messages.',
    id: 'google',
    label: 'Google',
    showBaseUrl: false,
  },
  {
    apiKeyOptional: false,
    baseUrlRequired: false,
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    description: 'Connect Mistral models for fast, capable assistance.',
    extraBodyExample: '{\n  "safe_prompt": true\n}',
    extraBodyHelp: 'Add optional settings for your Mistral messages.',
    id: 'mistral',
    label: 'Mistral AI',
    showBaseUrl: false,
  },
  {
    apiKeyOptional: false,
    baseUrlRequired: false,
    defaultBaseUrl: 'https://api.deepseek.com',
    description: 'Use DeepSeek V4 with thinking ready by default.',
    extraBodyExample: '{\n  "thinking": {\n    "type": "enabled"\n  }\n}',
    extraBodyHelp: 'Add optional preferences for DeepSeek responses.',
    id: 'deepseek',
    label: 'DeepSeek',
    showBaseUrl: false,
  },
] as const

export function getApiKeyProviderSchema(providerId: BuiltInApiKeyProviderId) {
  return API_KEY_PROVIDER_SCHEMAS.find((schema) => schema.id === providerId)
}
