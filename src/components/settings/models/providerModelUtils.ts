import type { ProviderModelConfig } from '../../../types/chat'
import type { ModelCatalogItem } from './modelTypes'

export function toProviderModelCatalogItems(providerModels: readonly ProviderModelConfig[]): ModelCatalogItem[] {
  return providerModels.map((model) => ({
    apiModelId: model.apiModelId,
    ...(model.defaultReasoningEffort ? { defaultReasoningEffort: model.defaultReasoningEffort } : {}),
    enabledByDefault: model.enabledByDefault,
    ...(model.extraBody ? { extraBody: model.extraBody } : {}),
    id: model.id,
    label: model.label,
    providerId: model.providerId,
    reasoningCapable: model.reasoningCapable,
    ...(model.reasoningBodies ? { reasoningBodies: model.reasoningBodies } : {}),
    ...(model.reasoningEfforts ? { reasoningEfforts: model.reasoningEfforts } : {}),
  }))
}
