import assert from 'node:assert/strict'
import test from 'node:test'
import type { ApiKeyChatProviderConfig } from '../../electron/chat/apiKey/config'
import {
  mergeRequestExtras,
  resolveModelExtraBody,
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

test('custom provider extra settings resolve only for the exact selected model', () => {
  const config = createConfig({
    models: [
      { apiModelId: 'model-a', extraBody: { temperature: 0.2 } },
      { apiModelId: 'model-b', extraBody: { temperature: 0.8 } },
    ],
  })

  assert.deepEqual(resolveModelExtraBody(config, 'model-a'), { temperature: 0.2 })
  assert.deepEqual(resolveModelExtraBody(config, 'model-b'), { temperature: 0.8 })
  assert.deepEqual(resolveModelExtraBody(config, 'unknown'), {})
})

test('built-in providers never resolve arbitrary model extra settings', () => {
  const config = createConfig({
    models: [{ apiModelId: 'gpt-custom', extraBody: { store: false } }],
    providerId: 'openai',
  })

  assert.deepEqual(resolveModelExtraBody(config, 'gpt-custom'), {})
})

test('reasoning and cache layers can override generic model settings predictably', () => {
  const merged = mergeRequestExtras(
    mergeRequestExtras(
      { chat_template_kwargs: { enable_thinking: false, stable: true }, temperature: 0.4 },
      { chat_template_kwargs: { enable_thinking: true } },
    ),
    { temperature: 0.1 },
  )

  assert.deepEqual(merged, {
    chat_template_kwargs: { enable_thinking: true, stable: true },
    temperature: 0.1,
  })
})
