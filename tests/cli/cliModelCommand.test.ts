import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getDesktopCompatibleProviderIds,
  getModelAddLaunchRequest,
  resolveModelAddLaunchRequest,
} from '../../electron/cli/cliModelCommand'
import type { StoredApiKeyProviders } from '../../electron/providers/store'
import { buildProviderAddLaunchRequest } from '../../electron/cli/cliProviderCommand'

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
