import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTideCodeLaunchRequest,
  serializeTideCodeLaunchRequest,
} from '../../src/lib/appLaunchRequest'

test('desktop model add requests round-trip through the CLI argument', () => {
  const request = { screen: 'settings', section: 'models', action: 'add-model', providerId: 'openai' } as const
  const argument = serializeTideCodeLaunchRequest(request)

  assert.deepEqual(parseTideCodeLaunchRequest(['node', argument]), request)
})

test('desktop custom-provider requests round-trip through the CLI argument', () => {
  const request = {
    action: 'add-custom-provider',
    apiKeyHandoffToken: '0123456789abcdef0123456789abcdef0123456789a',
    baseUrl: 'https://example.test/v1',
    providerName: 'Example',
    screen: 'settings',
    section: 'providers',
  } as const
  const argument = serializeTideCodeLaunchRequest(request)

  assert.deepEqual(parseTideCodeLaunchRequest(['node', argument]), request)
})

test('desktop provider launch arguments never contain an API key field', () => {
  const request = {
    action: 'add-custom-provider',
    apiKeyHandoffToken: '0123456789abcdef0123456789abcdef0123456789a',
    baseUrl: 'https://example.test/v1',
    providerName: 'Example',
    screen: 'settings',
    section: 'providers',
  } as const
  const argument = serializeTideCodeLaunchRequest(request)

  assert.equal(argument.includes('sk-test'), false)
  const encodedPayload = argument.slice('--tidecode-launch='.length)
  const payload = JSON.parse(decodeURIComponent(encodedPayload)) as Record<string, unknown>
  assert.equal(Object.hasOwn(payload, 'apiKey'), false)
})

test('section-only model requests open model management without a dialog action', () => {
  const request = { screen: 'settings', section: 'models' } as const
  const argument = serializeTideCodeLaunchRequest(request)

  assert.deepEqual(parseTideCodeLaunchRequest(['node', argument]), request)
})

test('unrelated arguments do not produce a desktop launch request', () => {
  assert.equal(parseTideCodeLaunchRequest(['node', '--tidecode-install-update', '--example']), null)
})

test('malformed launch payloads are rejected without throwing', () => {
  assert.equal(parseTideCodeLaunchRequest(['--tidecode-launch=%E0%A4%A']), null)
  assert.equal(parseTideCodeLaunchRequest(['--tidecode-launch=not-json']), null)
})

test('unsupported launch destinations and actions are rejected', () => {
  const unsupportedRequests = [
    { screen: 'chat', section: 'models' },
    { screen: 'settings', section: 'history' },
    { screen: 'settings', section: 'models', action: 'remove-model' },
    { screen: 'settings', section: 'providers', action: 'add-model' },
    { screen: 'settings', section: 'models', extra: 'unsafe' },
    { screen: 'settings', section: 'models', action: 'add-model', providerId: 'file:///unsafe' },
    { screen: 'settings', section: 'providers', action: 'add-custom-provider', baseUrl: 'file:///unsafe' },
    { screen: 'settings', section: 'providers', action: 'add-custom-provider', apiKey: '' },
  ]

  for (const value of unsupportedRequests) {
    const encoded = encodeURIComponent(JSON.stringify(value))
    assert.equal(parseTideCodeLaunchRequest([`--tidecode-launch=${encoded}`]), null)
  }
})

test('unrelated arguments do not affect a valid request', () => {
  const request = { screen: 'settings', section: 'providers' } as const
  const argument = serializeTideCodeLaunchRequest(request)

  assert.deepEqual(
    parseTideCodeLaunchRequest(['--foo', '--tidecode-install-update', argument, '--bar']),
    request,
  )
})
