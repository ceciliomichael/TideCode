import type { ProviderModelConfig } from '../../../../src/types/chat'
import { listCatalogModels } from '../../catalog/catalog'

export function listCodexModels(): ProviderModelConfig[] {
  return listCatalogModels('codex')
}
