import type { ChatProviderId } from '../../../src/types/chat'
import { findCatalogModel } from '../../models/catalog/catalog'
import { CompactionError } from './compaction/gate'
import { listStoredCustomModels } from '../../models/store'
import { readStoredApiKeyProviders } from '../../providers/store'
import { isApiKeyProviderId } from '../../providers/providerIds'

export async function resolveStoredOutputMaximum(providerId: ChatProviderId, modelId: string) {
  const catalogMaximum = findCatalogModel(providerId, modelId)?.maxTokens
  if (catalogMaximum !== undefined || !isApiKeyProviderId(providerId)) {
    return catalogMaximum
  }
  const [models, providers] = await Promise.all([listStoredCustomModels(), readStoredApiKeyProviders()])
  const matches = (candidate: { apiModelId: string }) => candidate.apiModelId.trim().toLowerCase() === modelId.trim().toLowerCase()
  return models.find((model) => model.providerId === providerId && matches(model))?.maxTokens
    ?? providers[providerId]?.models?.find(matches)?.maxTokens
}

export interface ContextCapabilities {
  providerId?: ChatProviderId
  modelId?: string
  contextWindowTokens: number
  maxOutputTokens: number
  countingMethod: 'heuristic'
}

/** Catalog maxTokens is an output limit. Unknown context capacity stays configured. */
export function resolveContextCapabilities(input: {
  providerId: ChatProviderId
  modelId: string
  contextWindowTokens: number
  maximumOutputTokens?: number
}): ContextCapabilities {
  const capacity = input.contextWindowTokens
  if (!Number.isFinite(capacity) || capacity < 1) {
    throw new CompactionError('invalid_context_budget')
  }
  const catalogMaximum = findCatalogModel(input.providerId, input.modelId)?.maxTokens
  let outputTokens = Math.min(20_000, Math.floor(capacity * 0.25))
  for (const outputMaximum of [input.maximumOutputTokens, catalogMaximum]) {
    if (outputMaximum !== undefined && Number.isFinite(outputMaximum) && outputMaximum > 0) {
      outputTokens = Math.min(outputTokens, Math.floor(outputMaximum))
    }
  }
  return {
    providerId: input.providerId,
    modelId: input.modelId,
    contextWindowTokens: Math.floor(capacity),
    maxOutputTokens: outputTokens,
    countingMethod: 'heuristic',
  }
}
