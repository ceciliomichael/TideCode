import type { ProviderModelConfig } from '../../../types/chat'

export function mergeProviderModels(
  existingModels: readonly ProviderModelConfig[],
  incomingModels: readonly ProviderModelConfig[],
): ProviderModelConfig[] {
  const getIdentity = (model: ProviderModelConfig) =>
    `${model.providerId}::${(model.apiModelId || model.id).trim().toLowerCase()}`
  const seenModelIds = new Set(existingModels.map(getIdentity))
  const mergedModels = [...existingModels]

  for (const model of incomingModels) {
    const identity = getIdentity(model)
    if (seenModelIds.has(identity)) {
      continue
    }

    seenModelIds.add(identity)
    mergedModels.push(model)
  }

  return mergedModels
}
