import assert from 'node:assert/strict'
import test from 'node:test'
import type { ApiKeyChatProviderConfig } from '../../electron/chat/apiKey/config'
import {
  mergeRequestExtras,
  resolveProviderReasoningOptions,
  resolveReasoningExtraBody,
} from '../../electron/chat/apiKey/reasoning'

function createConfig(overrides: Partial<ApiKeyChatProviderConfig>): ApiKeyChatProviderConfig {
  return {
    apiKey: 'secret',
    baseUrl: 'https://example.com/v1',
    extraBody: {},
    models: [],
    providerId: 'custom:test-provider',
    ...overrides,
  }
}

test('DeepSeek thinking is enabled and maximum effort is translated correctly', () => {
  const config = createConfig({ providerId: 'deepseek' })
  assert.deepEqual(resolveReasoningExtraBody(config, 'deepseek-v4-pro', 'max'), {
    reasoning_effort: 'max',
    thinking: { type: 'enabled' },
  })
})

test('custom reasoning sends the exact body declared by the model JSON', () => {
  const config = createConfig({
    models: [{
      apiModelId: 'my-model',
      reasoningBodies: { high: { custom_thinking: { enabled: true } } },
      reasoningCapable: true,
      reasoningEfforts: ['high'],
    }],
    providerId: 'custom:provider123',
  })
  assert.deepEqual(resolveReasoningExtraBody(config, 'my-model', 'high'), {
    custom_thinking: { enabled: true },
  })
  assert.equal(resolveProviderReasoningOptions(config, 'my-model', 'high'), undefined)
})
