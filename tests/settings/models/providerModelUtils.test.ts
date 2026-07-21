import assert from 'node:assert/strict'
import test from 'node:test'
import { toProviderModelCatalogItems } from '../../../src/components/settings/models/providerModelUtils'

test('toProviderModelCatalogItems preserves backend default state for provider models', () => {
  const catalogItems = toProviderModelCatalogItems([
    {
      apiModelId: 'codex-a',
      enabledByDefault: true,
      id: 'codex-a',
      label: 'Codex A',
      providerId: 'codex',
      reasoningCapable: true,
    },
    {
      apiModelId: 'custom-test-b',
      enabledByDefault: false,
      id: 'custom-test-b',
      label: 'OpenAI Compatible B',
      providerId: 'custom:test-provider',
      reasoningCapable: false,
    },
  ])

  assert.deepEqual(catalogItems, [
    {
      apiModelId: 'codex-a',
      enabledByDefault: true,
      id: 'codex-a',
      label: 'Codex A',
      providerId: 'codex',
      reasoningCapable: true,
    },
    {
      apiModelId: 'custom-test-b',
      enabledByDefault: false,
      id: 'custom-test-b',
      label: 'OpenAI Compatible B',
      providerId: 'custom:test-provider',
      reasoningCapable: false,
    },
  ])
})
