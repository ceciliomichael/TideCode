import type { ModelCatalogItem } from './modelTypes'

export function getModelCatalogIdentity(model: Pick<ModelCatalogItem, 'apiModelId' | 'id' | 'providerId'>) {
  return `${model.providerId}::${(model.apiModelId ?? model.id).trim().toLowerCase()}`
}

export function dedupeModelCatalogItems(models: readonly ModelCatalogItem[]): ModelCatalogItem[] {
  const uniqueModels = new Map<string, ModelCatalogItem>()
  for (const model of models) {
    const identity = getModelCatalogIdentity(model)
    if (!uniqueModels.has(identity)) uniqueModels.set(identity, model)
  }
  return Array.from(uniqueModels.values())
}
