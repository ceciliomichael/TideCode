import assert from 'node:assert/strict'
import test from 'node:test'
import { selectActiveCodexUsageSnapshot } from '../../src/components/chat/codexUsage'
import type { ProvidersState } from '../../src/types/chat'

function buildProvidersState(): ProvidersState {
  return {
    apiKeyProviders: [],
    codex: {
      accountId: 'workspace-a',
      accountKey: 'workspace-a::user-1',
      accounts: [
        {
          accountId: 'workspace-a',
          accountKey: 'workspace-a::user-1',
          email: 'user@example.com',
          isActive: true,
          label: 'User',
          lastRefreshAt: null,
          tokenExpiresAt: null,
          usage: {
            fetchedAt: '2026-05-03T00:00:00.000Z',
            primary: {
              usedPercent: 42,
              limitWindowSeconds: 18_000,
              resetAfterSeconds: 1_800,
              resetAt: 123,
            },
            secondary: null,
          },
        },
      ],
      authFilePath: 'C:/Users/Administrator/.echosphere/config/providers/codex/auth.json',
      email: 'user@example.com',
      isAuthenticated: true,
      lastRefreshAt: null,
      tokenExpiresAt: null,
    },
  }
}

test('Codex usage selection stays hidden until providers state is ready', () => {
  assert.equal(selectActiveCodexUsageSnapshot('codex', null, true), undefined)
  assert.equal(selectActiveCodexUsageSnapshot('codex', buildProvidersState(), true), undefined)
})

test('Codex usage selection returns the active account usage only for Codex models', () => {
  const providersState = buildProvidersState()

  assert.equal(selectActiveCodexUsageSnapshot('openai', providersState, false), undefined)
  assert.deepEqual(selectActiveCodexUsageSnapshot('codex', providersState, false), providersState.codex.accounts[0]?.usage)
})
