import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeProviderModels } from '../../../src/components/settings/models/providerModelMergeUtils'

test('mergeProviderModels preserves existing models and appends new ones', () => {
  const existingModels = [
    {
      enabledByDefault: true,
      id: 'alpha',
      label: 'Alpha',
      providerId: 'custom:test-provider' as const,
      reasoningCapable: false,
    },
  ]
  const incomingModels = [
    {
      enabledByDefault: true,
      id: 'alpha',
      label: 'Alpha updated',
      providerId: 'custom:test-provider' as const,
      reasoningCapable: false,
    },
    {
      enabledByDefault: false,
      id: 'beta',
      label: 'Beta',
      providerId: 'custom:test-provider' as const,
      reasoningCapable: false,
    },
  ]

  assert.deepEqual(mergeProviderModels(existingModels, incomingModels), [
    {
      enabledByDefault: true,
      id: 'alpha',
      label: 'Alpha',
      providerId: 'custom:test-provider',
      reasoningCapable: false,
    },
    {
      enabledByDefault: false,
      id: 'beta',
      label: 'Beta',
      providerId: 'custom:test-provider',
      reasoningCapable: false,
    },
  ])
})
