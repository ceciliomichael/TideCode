import assert from 'node:assert/strict'
import test from 'node:test'
import {
  sanitizeStoredUserModelCatalog,
  USER_MODEL_CATALOG_VERSION,
} from '../../electron/models/userCatalogSchema'
import {
  buildUserModelReasoningProfile,
  getSelectableUserModelEfforts,
  getUserModelReasoningKind,
} from '../../src/lib/userModelReasoning'

test('user model catalogs retain a model-specific enabled or disabled reasoning profile', () => {
  const catalog = sanitizeStoredUserModelCatalog({
    models: [{
      api_model_id: 'mistral-custom-latest',
      created_at: '2026-07-22T00:00:00.000Z',
      default_reasoning_effort: 'none',
      id: 'mistral:custom:stable-id',
      label: 'Custom Mistral',
      reasoning_capable: true,
      reasoning_efforts: ['none', 'high'],
      updated_at: '2026-07-22T00:00:00.000Z',
    }],
    provider_id: 'mistral',
    version: USER_MODEL_CATALOG_VERSION,
  })

  assert.equal(catalog?.provider_id, 'mistral')
  assert.deepEqual(catalog?.models[0]?.reasoning_efforts, ['none', 'high'])
  assert.equal(catalog?.models[0]?.default_reasoning_effort, 'none')
})

test('invalid reasoning profiles are rejected at the catalog boundary', () => {
  const catalog = sanitizeStoredUserModelCatalog({
    models: [{
      api_model_id: 'broken-model',
      id: 'openai:custom:broken',
      label: 'Broken',
      reasoning_capable: true,
      reasoning_efforts: [],
    }],
    provider_id: 'openai',
    version: USER_MODEL_CATALOG_VERSION,
  })

  assert.deepEqual(catalog?.models, [])
})

test('custom provider catalogs retain validated model-specific extra settings', () => {
  const catalog = sanitizeStoredUserModelCatalog({
    models: [{
      api_model_id: 'thinking-model',
      extra_body: { chat_template_kwargs: { enable_thinking: true } },
      id: 'custom:server01:custom:thinking-model',
      label: 'Thinking model',
      reasoning_capable: false,
    }],
    provider_id: 'custom:server01',
    version: USER_MODEL_CATALOG_VERSION,
  })

  assert.deepEqual(catalog?.models[0]?.extra_body, {
    chat_template_kwargs: { enable_thinking: true },
  })
})

test('built-in provider catalogs discard arbitrary model extra settings', () => {
  const catalog = sanitizeStoredUserModelCatalog({
    models: [{
      api_model_id: 'gpt-custom',
      extra_body: { store: false },
      id: 'openai:custom:gpt-custom',
      label: 'GPT custom',
      reasoning_capable: false,
    }],
    provider_id: 'openai',
    version: USER_MODEL_CATALOG_VERSION,
  })

  assert.equal(catalog?.models[0]?.extra_body, undefined)
})

test('custom provider catalogs reject extra settings that replace reserved request fields', () => {
  const catalog = sanitizeStoredUserModelCatalog({
    models: [{
      api_model_id: 'unsafe-model',
      extra_body: { messages: [] },
      id: 'custom:server01:custom:unsafe-model',
      label: 'Unsafe model',
      reasoning_capable: false,
    }],
    provider_id: 'custom:server01',
    version: USER_MODEL_CATALOG_VERSION,
  })

  assert.deepEqual(catalog?.models, [])
})

test('custom providers receive an OpenAI-compatible body for every selected effort', () => {
  assert.deepEqual(buildUserModelReasoningProfile({
    defaultEffort: 'high',
    kind: 'toggle',
    providerId: 'custom:provider_12345678',
  }), {
    defaultReasoningEffort: 'high',
    reasoningBodies: {
      none: { reasoning_effort: 'none' },
      high: { reasoning_effort: 'high' },
    },
    reasoningCapable: true,
    reasoningEfforts: ['none', 'high'],
  })
})

test('built-in providers use their native reasoning transport without custom bodies', () => {
  assert.deepEqual(buildUserModelReasoningProfile({
    defaultEffort: 'medium',
    effortChoices: ['low', 'medium', 'high'],
    kind: 'effort',
    providerId: 'openai',
  }), {
    defaultReasoningEffort: 'medium',
    reasoningCapable: true,
    reasoningEfforts: ['low', 'medium', 'high'],
  })
})

test('reasoning control type is derived independently for each model', () => {
  assert.equal(getUserModelReasoningKind(false, undefined), 'none')
  assert.equal(getUserModelReasoningKind(true, ['none', 'high']), 'toggle')
  assert.equal(getUserModelReasoningKind(true, ['low', 'medium', 'high']), 'effort')
})

test('native providers only expose reasoning efforts supported by their transport', () => {
  assert.deepEqual(getSelectableUserModelEfforts('mistral'), ['high'])
  assert.deepEqual(getSelectableUserModelEfforts('deepseek'), ['none', 'high', 'max'])
  assert.deepEqual(getSelectableUserModelEfforts('codex'), ['low', 'medium', 'high', 'xhigh'])
})
