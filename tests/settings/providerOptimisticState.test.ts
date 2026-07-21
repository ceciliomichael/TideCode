import assert from 'node:assert/strict'
import test from 'node:test'
import type { ApiKeyProviderStatus, ProvidersState } from '../../src/types/chat'
import {
  applyOptimisticProviderRemoval,
  applyOptimisticProviderSave,
} from '../../src/hooks/providerOptimisticState'

const codex: ProvidersState['codex'] = {
  accountId: null,
  accountKey: null,
  accounts: [],
  authFilePath: '',
  email: null,
  isAuthenticated: false,
  lastRefreshAt: null,
  tokenExpiresAt: null,
}

function createProvider(overrides: Partial<ApiKeyProviderStatus>): ApiKeyProviderStatus {
  return {
    apiKey: null,
    baseUrl: null,
    configured: false,
    extraBody: '',
    hasApiKey: false,
    id: 'openai',
    isCustom: false,
    label: 'OpenAI',
    models: [],
    ...overrides,
  }
}

test('optimistic save adds a configured custom provider immediately', () => {
  const current: ProvidersState = { apiKeyProviders: [], codex }
  const next = applyOptimisticProviderSave(current, {
    apiKey: 'secret',
    baseUrl: 'http://localhost:1234/v1',
    extraBody: '{"reasoning":true}',
    label: 'Local model',
    models: [],
    providerId: 'custom:provider123',
  })

  assert.equal(next?.apiKeyProviders.length, 1)
  assert.deepEqual(next?.apiKeyProviders[0], {
    apiKey: null,
    baseUrl: 'http://localhost:1234/v1',
    configured: true,
    extraBody: '{"reasoning":true}',
    hasApiKey: true,
    id: 'custom:provider123',
    isCustom: true,
    label: 'Local model',
    models: [],
  })
})

test('optimistic clear resets a built-in provider without removing its card', () => {
  const current: ProvidersState = {
    apiKeyProviders: [createProvider({ configured: true, hasApiKey: true })],
    codex,
  }
  const next = applyOptimisticProviderRemoval(current, 'openai')

  assert.equal(next?.apiKeyProviders.length, 1)
  assert.equal(next?.apiKeyProviders[0]?.configured, false)
  assert.equal(next?.apiKeyProviders[0]?.hasApiKey, false)
})

test('optimistic remove deletes a custom provider card immediately', () => {
  const current: ProvidersState = {
    apiKeyProviders: [
      createProvider({
        configured: true,
        id: 'custom:provider123',
        isCustom: true,
        label: 'Local model',
      }),
    ],
    codex,
  }
  const next = applyOptimisticProviderRemoval(current, 'custom:provider123')

  assert.deepEqual(next?.apiKeyProviders, [])
})
