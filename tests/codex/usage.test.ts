import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fetchCodexUsageSnapshot } from '../../electron/providers/codex/usage'

function createUsageResponseBody(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
    },
    status: 200,
  })
}

test('fetchCodexUsageSnapshot parses the current snake_case Codex usage response', async () => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async () =>
    createUsageResponseBody({
      rate_limit: {
        primary_window: {
          limit_window_seconds: 18_000,
          reset_after_seconds: 900,
          reset_at: 1_700_000_900,
          used_percent: 42.5,
        },
        secondary_window: {
          limit_window_seconds: 604_800,
          reset_after_seconds: 86_400,
          reset_at: 1_700_086_400,
          used_percent: 12,
        },
      },
    })) as typeof fetch

  try {
    const snapshot = await fetchCodexUsageSnapshot({
      accessToken: 'token',
      accountId: 'account',
    })

    assert.equal(snapshot.primary?.usedPercent, 42.5)
    assert.equal(snapshot.primary?.limitWindowSeconds, 18_000)
    assert.equal(snapshot.primary?.resetAfterSeconds, 900)
    assert.equal(snapshot.primary?.resetAt, 1_700_000_900)
    assert.equal(snapshot.secondary?.usedPercent, 12)
    assert.equal(snapshot.secondary?.limitWindowSeconds, 604_800)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchCodexUsageSnapshot accepts hourly and weekly window naming drift', async () => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async () =>
    createUsageResponseBody({
      rateLimit: {
        hourlyWindow: {
          limitWindowSeconds: '18000',
          resetAfterSeconds: '1200',
          resetAt: '1700001200',
          usedPercent: '50',
        },
        weeklyWindow: {
          limit_window_seconds: 604_800,
          reset_after_seconds: 43_200,
          reset_at: 1_700_043_200,
          used_percent: 25,
        },
      },
    })) as typeof fetch

  try {
    const snapshot = await fetchCodexUsageSnapshot({
      accessToken: 'token',
      accountId: 'account',
    })

    assert.equal(snapshot.primary?.usedPercent, 50)
    assert.equal(snapshot.primary?.limitWindowSeconds, 18_000)
    assert.equal(snapshot.primary?.resetAfterSeconds, 1_200)
    assert.equal(snapshot.primary?.resetAt, 1_700_001_200)
    assert.equal(snapshot.secondary?.usedPercent, 25)
    assert.equal(snapshot.secondary?.limitWindowSeconds, 604_800)
    assert.equal(snapshot.secondary?.resetAfterSeconds, 43_200)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('getCodexProviderStatus returns hydrated status and retains cached usage when called unhydrated', async () => {
  const homeDirectory = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-codex-test-'))

  const { getCodexProviderStatus } = await import('../../electron/providers/codex/service')
  const { writeStoredCodexAuthData, StoredCodexAuthData } = await import('../../electron/providers/codex/store')
  const { upsertStoredCodexAccount } = await import('../../electron/providers/codex/accounts')

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    createUsageResponseBody({
      rate_limit: {
        primary_window: {
          limit_window_seconds: 18_000,
          reset_after_seconds: 900,
          reset_at: 1_700_000_900,
          used_percent: 15,
        },
      },
    })) as typeof fetch

  const authData: InstanceType<typeof StoredCodexAuthData> | Record<string, unknown> = {
    auth_mode: 'chatgpt',
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    last_refresh: new Date().toISOString(),
    tokens: {
      access_token: 'test-access-token',
      account_id: 'test-account-id',
      account_key: 'test-account-key',
      id_token: 'eyJhbGciOiJIUzI1NiJ9.e30.secret',
      refresh_token: 'test-refresh-token',
    },
  }

  try {
    await writeStoredCodexAuthData(authData as any, { homeDirectory })
    await upsertStoredCodexAccount(authData as any, 'Test Account', { homeDirectory })

    // Hydrated call populates usage
    const hydratedStatus = await getCodexProviderStatus(true, { homeDirectory })
    assert.equal(hydratedStatus.isAuthenticated, true)
    const activeAccount = hydratedStatus.accounts.find((acc) => acc.accountKey === 'test-account-key')
    assert.ok(activeAccount)
    assert.equal(activeAccount?.usage?.primary?.usedPercent, 15)

    // Subsequent unhydrated call preserves cached usage instead of returning null
    const unhydratedStatus = await getCodexProviderStatus(false, { homeDirectory })
    const unhydratedAccount = unhydratedStatus.accounts.find((acc) => acc.accountKey === 'test-account-key')
    assert.ok(unhydratedAccount)
    assert.equal(unhydratedAccount?.usage?.primary?.usedPercent, 15)
  } finally {
    globalThis.fetch = originalFetch
    await fs.rm(homeDirectory, { force: true, recursive: true })
  }
})
