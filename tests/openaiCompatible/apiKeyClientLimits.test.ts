import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import type { ApiKeyChatProviderConfig } from '../../electron/chat/apiKey/config'
import { createApiKeyChatClient } from '../../electron/chat/apiKey/client'

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

async function captureRequestBody(
  config: ApiKeyChatProviderConfig,
  model: string,
) {
  const originalFetch = globalThis.fetch
  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>
    return new Response('data: [DONE]\n\n', {
      headers: { 'content-type': 'text/event-stream' },
      status: 200,
    })
  }

  try {
    const stream = await createApiKeyChatClient(config).chat.completions.create({
      messages: [{ content: 'Write one short sentence.', role: 'user' } as ModelMessage],
      model,
      reasoningEffort: 'none',
    })
    for await (const part of stream.fullStream) {
      void part
    }
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.ok(requestBody)
  return requestBody
}

test('built-in providers use the exact catalog maxTokens value on the wire', async () => {
  const requestBody = await captureRequestBody(
    createConfig({
      models: [{ apiModelId: 'deepseek-v4-flash', maxTokens: 8192 }],
      providerId: 'deepseek',
    }),
    'deepseek-v4-flash',
  )

  assert.equal(requestBody.max_tokens, 384000)
})

test('custom providers use their configured model maxTokens value', async () => {
  const requestBody = await captureRequestBody(
    createConfig({
      models: [{ apiModelId: 'custom-model', maxTokens: 12345 }],
    }),
    'custom-model',
  )

  assert.equal(requestBody.max_tokens, 12345)
})

test('built-in providers use a saved custom model limit when the model is not in the catalog', async () => {
  const requestBody = await captureRequestBody(
    createConfig({
      models: [{ apiModelId: 'openai-compatible-model', maxTokens: 23456 }],
      providerId: 'openai',
    }),
    'openai-compatible-model',
  )

  assert.equal(requestBody.max_output_tokens, 23456)
})
