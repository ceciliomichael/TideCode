import type { CustomApiKeyProviderId, ProviderModelConfig } from '../../../src/types/chat'
import { readStoredApiKeyProviders } from '../../providers/store'
import { normalizeProviderModelConfigs } from './shared'

export async function listConfiguredProviderModels(
  providerId: CustomApiKeyProviderId,
): Promise<ProviderModelConfig[]> {
  const providers = await readStoredApiKeyProviders()
  const models = providers[providerId]?.models ?? []
  const definitions = models.map((model) => ({
    ...model,
    id: model.id?.trim() || `${providerId}:${model.apiModelId}`,
  }))
  return normalizeProviderModelConfigs(providerId, definitions)
}
