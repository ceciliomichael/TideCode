import assert from 'node:assert/strict'
import test from 'node:test'
import { parseConfigurableProviderModels } from '../../electron/providers/providerModels'
import { normalizeProviderModelConfigs } from '../../electron/models/providers/shared'

test('custom model JSON derives reasoning choices from exact request bodies', () => {
  assert.deepEqual(parseConfigurableProviderModels([{
    apiModelId: 'local-reasoner',
    defaultReasoningEffort: 'high',
    maxTokens: 8192,
    reasoningBodies: {
      none: { thinking: { type: 'disabled' } },
      high: { thinking: { type: 'enabled' } },
    },
  }]), [{
    apiModelId: 'local-reasoner',
    defaultReasoningEffort: 'high',
    maxTokens: 8192,
    reasoningBodies: {
      none: { thinking: { type: 'disabled' } },
      high: { thinking: { type: 'enabled' } },
    },
    reasoningCapable: true,
    reasoningEfforts: ['none', 'high'],
  }])
})

test('custom reasoning models require a request body for every available choice', () => {
  assert.throws(
    () => parseConfigurableProviderModels([{
      apiModelId: 'invalid-reasoner',
      reasoningCapable: true,
      reasoningEfforts: ['high'],
    }]),
    /reasoningBodies/u,
  )
})

test('provider catalogs deduplicate the same API model id case-insensitively', () => {
  const models = normalizeProviderModelConfigs('custom:test1234', [
    { apiModelId: 'Model-A', id: 'first', label: 'First' },
    { apiModelId: 'model-a', id: 'second', label: 'Second' },
  ])
  assert.equal(models.length, 1)
  assert.equal(models[0]?.id, 'first')
})
