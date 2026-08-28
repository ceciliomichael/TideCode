import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getDesktopCompatibleProviderIds,
  getModelAddLaunchRequest,
  resolveModelAddLaunchRequest,
  selectReasoningEffortForModel,
} from '../../electron/cli/cliModelCommand'
import type { StoredApiKeyProviders } from '../../electron/providers/store'
import { buildProviderAddLaunchRequest } from '../../electron/cli/cliProviderCommand'
import type { SlashCommandHelpers } from '../../electron/cli/types'

test('model setup routes to desktop Models when a provider is configured', () => {
  assert.deepEqual(getModelAddLaunchRequest(true), {
    action: 'add-model',
    screen: 'settings',
    section: 'models',
  })
})

test('model setup routes to desktop Providers when no provider is configured', () => {
  assert.deepEqual(getModelAddLaunchRequest(false), {
    action: 'add-custom-provider',
    screen: 'settings',
    section: 'providers',
  })
})

test('model setup carries the requested provider for desktop preselection', () => {
  assert.deepEqual(getModelAddLaunchRequest(true, 'anthropic'), {
    action: 'add-model',
    providerId: 'anthropic',
    screen: 'settings',
    section: 'models',
  })
})

test('provider add arguments become desktop custom-provider prefill values', () => {
  assert.deepEqual(buildProviderAddLaunchRequest(['Example', 'https://example.test/v1', 'sk-test']), {
    apiKey: 'sk-test',
    request: {
      action: 'add-custom-provider',
      baseUrl: 'https://example.test/v1',
      providerName: 'Example',
      screen: 'settings',
      section: 'providers',
    },
  })
  assert.equal(buildProviderAddLaunchRequest(['Example', 'file:///unsafe', 'sk-test']), null)
})

test('desktop-compatible provider availability ignores environment-only credentials', () => {
  const storedProviders: StoredApiKeyProviders = {}
  assert.deepEqual(getDesktopCompatibleProviderIds(storedProviders, false), [])
  assert.deepEqual(getDesktopCompatibleProviderIds({
    openai: { api_key: 'stored-key', updated_at: '2026-08-16T00:00:00.000Z' },
  }, false), ['openai'])
})

test('Codex desktop compatibility follows active authentication state', () => {
  const storedProviders: StoredApiKeyProviders = {}
  assert.deepEqual(getDesktopCompatibleProviderIds(storedProviders, false), [])
  assert.deepEqual(getDesktopCompatibleProviderIds(storedProviders, true), ['codex'])
})

test('requested unavailable providers are rejected instead of being replaced', () => {
  assert.equal(resolveModelAddLaunchRequest(['openai'], 'anthropic'), null)
  assert.deepEqual(resolveModelAddLaunchRequest(['openai'], 'openai'), {
    action: 'add-model',
    providerId: 'openai',
    screen: 'settings',
    section: 'models',
  })
})

test('CLI model selection asks for reasoning effort using only the selected model capabilities', async () => {
  let receivedItems: readonly unknown[] = []
  const helpers = {
    select: async (options: { items: readonly unknown[] }) => {
      receivedItems = options.items
      return 'low'
    },
  } as unknown as SlashCommandHelpers
  const selected = await selectReasoningEffortForModel({
    apiModelId: 'gpt-test',
    defaultReasoningEffort: 'medium',
    id: 'openai:gpt-test',
    isConfigured: true,
    isCustom: false,
    label: 'GPT Test',
    providerId: 'openai',
    providerLabel: 'OpenAI',
    reasoningCapable: true,
    reasoningEfforts: ['low', 'medium', 'high'],
  }, 'xhigh', helpers)

  assert.equal(selected, 'low')
  assert.equal(receivedItems.length, 3)
})

test('CLI model selection skips the reasoning prompt when the model has no reasoning control', async () => {
  let selectCount = 0
  const helpers = {
    select: async () => {
      selectCount += 1
      return 'high'
    },
  } as unknown as SlashCommandHelpers
  const selected = await selectReasoningEffortForModel({
    apiModelId: 'plain-model',
    id: 'openai:plain-model',
    isConfigured: true,
    isCustom: false,
    label: 'Plain Model',
    providerId: 'openai',
    providerLabel: 'OpenAI',
  }, 'medium', helpers)

  assert.equal(selected, 'medium')
  assert.equal(selectCount, 0)
})
