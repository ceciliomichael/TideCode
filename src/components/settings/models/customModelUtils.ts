import type { CustomModelConfig } from '../../../types/chat'
import type { ModelCatalogItem } from './modelTypes'

export function toCustomModelCatalogItems(customModels: readonly CustomModelConfig[]): ModelCatalogItem[] {
  return customModels.map((model) => ({
    apiModelId: model.apiModelId,
    enabledByDefault: true,
    ...(model.extraBody ? { extraBody: model.extraBody } : {}),
    id: model.id,
    isCustom: true,
    label: model.label,
    providerId: model.providerId,
    ...(model.defaultReasoningEffort ? { defaultReasoningEffort: model.defaultReasoningEffort } : {}),
    reasoningCapable: model.reasoningCapable,
    ...(model.reasoningBodies ? { reasoningBodies: model.reasoningBodies } : {}),
    ...(model.reasoningEfforts ? { reasoningEfforts: model.reasoningEfforts } : {}),
  }))
}
