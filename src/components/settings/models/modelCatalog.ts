import type { ModelCatalogItem, ProviderSectionDefinition } from './modelTypes'

export const PROVIDER_SECTIONS: readonly ProviderSectionDefinition[] = [
  {
    description: 'Models available with your ChatGPT account.',
    id: 'codex',
    label: 'Codex',
  },
  {
    description: 'Your OpenAI models.',
    id: 'openai',
    label: 'OpenAI',
  },
  {
    description: 'Your Claude models.',
    id: 'anthropic',
    label: 'Anthropic',
  },
  {
    description: 'Your Gemini models.',
    id: 'google',
    label: 'Google',
  },
  {
    description: 'Your Mistral models.',
    id: 'mistral',
    label: 'Mistral AI',
  },
  {
    description: 'DeepSeek models with optional thinking.',
    id: 'deepseek',
    label: 'DeepSeek',
  },
] as const

export const MODEL_CATALOG: readonly ModelCatalogItem[] = []
