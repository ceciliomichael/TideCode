import type { ChatProviderId, ProviderModelConfig } from '../../../src/types/chat'
import { isCustomApiKeyProviderId } from '../../providers/providerIds'
import { listCatalogModels } from '../catalog/catalog'
import { listConfiguredProviderModels } from './configuredModels'

export async function listProviderModels(providerId: ChatProviderId): Promise<ProviderModelConfig[]> {
  if (isCustomApiKeyProviderId(providerId)) {
    return listConfiguredProviderModels(providerId)
  }
  return listCatalogModels(providerId)
}
