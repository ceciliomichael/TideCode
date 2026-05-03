import assert from 'node:assert/strict'
import test from 'node:test'
import { buildModelProviderSections } from '../../../src/components/settings/models/modelViewUtils'
import type { ProvidersState } from '../../../src/types/chat'

test('buildModelProviderSections includes saved custom models for configured providers', () => {
  const providersState: ProvidersState = {
    apiKeyProviders: [
      {
        apiKey: null,
        baseUrl: null,
        configured: true,
        hasApiKey: false,
        id: 'openai-compatible',
        label: 'OpenAI Compatible',
      },
    ],
    codex: {
      accountId: null,
      accountKey: null,
      accounts: [],
      authFilePath: '',
      email: null,
      isAuthenticated: false,
      lastRefreshAt: null,
      tokenExpiresAt: null,
    },
  }

  const sections = buildModelProviderSections(
    '',
    providersState,
    [
      {
        apiModelId: 'my-custom-model',
        createdAt: '2025-01-01T00:00:00.000Z',
        id: 'openai-compatible:custom:1',
        label: 'My Custom Model',
        providerId: 'openai-compatible',
        reasoningCapable: false,
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ],
    [],
  )

  assert.equal(sections.length, 1)
  assert.equal(sections[0]?.provider.id, 'openai-compatible')
  assert.deepEqual(sections[0]?.models.map((model) => ({
    id: model.id,
    isCustom: model.isCustom,
    label: model.label,
    providerId: model.providerId,
  })), [
    {
      id: 'openai-compatible:custom:1',
      isCustom: true,
      label: 'My Custom Model',
      providerId: 'openai-compatible',
    },
  ])
})
