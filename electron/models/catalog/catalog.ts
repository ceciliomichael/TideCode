import type { ChatProviderId, ProviderModelConfig } from '../../../src/types/chat'
import anthropicModels from './anthropic_models.json'
import codexModels from './codex_models.json'
import deepseekModels from './deepseek_models.json'
import googleModels from './google_models.json'
import mistralModels from './mistral_models.json'
import openAIModels from './openai_models.json'
import { normalizeProviderModelConfigs } from '../providers/shared'

const CATALOGS: Partial<Record<ChatProviderId, readonly unknown[]>> = {
  anthropic: anthropicModels,
  codex: codexModels,
  deepseek: deepseekModels,
  google: googleModels,
  mistral: mistralModels,
  openai: openAIModels,
}

export function listCatalogModels(providerId: ChatProviderId): ProviderModelConfig[] {
  return normalizeProviderModelConfigs(providerId, CATALOGS[providerId] ?? [])
}

export function findCatalogModel(providerId: ChatProviderId, apiModelId: string) {
  const normalizedApiModelId = apiModelId.trim().toLowerCase()
  return listCatalogModels(providerId).find(
    (model) => model.apiModelId.trim().toLowerCase() === normalizedApiModelId,
  ) ?? null
}
