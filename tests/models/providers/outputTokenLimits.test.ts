import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatProviderId } from '../../../src/types/chat'
import { listCatalogModels } from '../../../electron/models/catalog/catalog'

const EXPECTED_LIMITS: Record<ChatProviderId, Record<string, number | undefined>> = {
  anthropic: {
    'claude-fable-5': 128000,
    'claude-haiku-4-5': 64000,
    'claude-opus-4-8': 128000,
    'claude-sonnet-5': 128000,
  },
  codex: {
    'gpt-5.5': 128000,
    'gpt-5.6-luna': 128000,
    'gpt-5.6-sol': 128000,
    'gpt-5.6-terra': 128000,
  },
  deepseek: {
    'deepseek-v4-flash': 384000,
    'deepseek-v4-pro': 384000,
  },
  google: {
    'gemini-3.1-pro-preview': 65536,
    'gemini-3.5-flash-lite': 65536,
    'gemini-3.6-flash': 65536,
  },
  mistral: {
    'mistral-large-latest': undefined,
    'mistral-medium-latest': undefined,
    'mistral-small-latest': undefined,
  },
  openai: {
    'gpt-5.5': 128000,
    'gpt-5.6-luna': 128000,
    'gpt-5.6-sol': 128000,
    'gpt-5.6-terra': 128000,
  },
}

for (const [providerId, expectedModels] of Object.entries(EXPECTED_LIMITS) as Array<[
  ChatProviderId,
  Record<string, number | undefined>,
]>) {
  test(`${providerId} catalog records the researched output-token limits`, () => {
    const actualModels = Object.fromEntries(
      listCatalogModels(providerId).map((model) => [model.apiModelId, model.maxTokens]),
    )

    assert.deepEqual(actualModels, expectedModels)
  })
}
