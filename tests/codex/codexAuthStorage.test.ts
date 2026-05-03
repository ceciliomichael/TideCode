import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  getCodexAccountsDirectoryPath,
  getCodexAuthFilePath,
  getCodexStorageRootPath,
  getStoredCodexAccountFilePath,
} from '../../electron/providers/codex/paths'
import { parseCodexIdTokenClaims } from '../../electron/providers/codex/jwt'
import {
  parseStoredCodexAuthData,
  readStoredCodexAuthData,
  toCodexProviderStatus,
  writeStoredCodexAuthData,
} from '../../electron/providers/codex/store'
import {
  listStoredCodexAccounts,
  readStoredCodexAccount,
  upsertStoredCodexAccount,
} from '../../electron/providers/codex/accounts'

function makeJwt(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

function buildStoredAuthData(input: { accountId: string; email: string; subject: string }) {
  const authData = parseStoredCodexAuthData({
    auth_mode: 'chatgpt',
    last_refresh: '2026-05-03T00:00:00.000Z',
    tokens: {
      access_token: makeJwt({
        email: input.email,
        sub: input.subject,
        organizations: [{ id: input.accountId }],
      }),
      id_token: makeJwt({
        email: input.email,
        exp: 1_714_694_400,
        sub: input.subject,
        'https://api.openai.com/auth': {
          chatgpt_account_id: input.accountId,
        },
      }),
      refresh_token: 'refresh-123',
    },
  })

  if (!authData) {
    throw new Error('Expected Codex auth data to parse.')
  }

  return authData
}

test('Codex auth paths resolve under EchoSphere config storage', async () => {
  const homeDirectory = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-codex-paths-'))

  try {
    const expectedRootPath = path.join(homeDirectory, '.echosphere', 'config', 'providers', 'codex')
    assert.equal(getCodexStorageRootPath(homeDirectory), expectedRootPath)
    assert.equal(getCodexAuthFilePath(homeDirectory), path.join(expectedRootPath, 'auth.json'))
    assert.equal(getCodexAccountsDirectoryPath(homeDirectory), path.join(expectedRootPath, 'accounts'))
    assert.equal(
      getStoredCodexAccountFilePath('acct-123::user-sub-1', homeDirectory),
      path.join(expectedRootPath, 'accounts', 'acct-123%3A%3Auser-sub-1.json'),
    )

    const providerStatus = toCodexProviderStatus(null, [], { homeDirectory })
    assert.equal(providerStatus.authFilePath, path.join(expectedRootPath, 'auth.json'))
    assert.equal(providerStatus.accountKey, null)
  } finally {
    await fs.rm(homeDirectory, { force: true, recursive: true })
  }
})

test('Codex token parsing accepts nested and fallback account claims', () => {
  const idTokenClaims = parseCodexIdTokenClaims(
    makeJwt({
      email: 'person@example.com',
      exp: 1_714_694_400,
      sub: 'user-sub-1',
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct-nested',
      },
    }),
  )

  assert.equal(idTokenClaims.accountId, 'acct-nested')
  assert.equal(idTokenClaims.accountKey, 'acct-nested::user-sub-1')
  assert.equal(idTokenClaims.email, 'person@example.com')
  assert.equal(idTokenClaims.expiresAt, new Date(1_714_694_400 * 1000).toISOString())

  const parsedFallbackAuth = parseStoredCodexAuthData({
    auth_mode: 'chatgpt',
    last_refresh: '2026-05-03T00:00:00.000Z',
    tokens: {
      access_token: makeJwt({
        email: 'person@example.com',
        sub: 'user-sub-2',
        organizations: [{ id: 'acct-access' }],
      }),
      id_token: makeJwt({
        email: 'person@example.com',
        exp: 1_714_694_400,
        sub: 'user-sub-2',
      }),
      refresh_token: 'refresh-123',
    },
  })

  assert.equal(parsedFallbackAuth?.tokens.account_id, 'acct-access')
  assert.equal(parsedFallbackAuth?.tokens.account_key, 'acct-access::user-sub-2')
})

test('Codex auth storage writes and reads EchoSphere-owned files', async () => {
  const homeDirectory = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-codex-storage-'))
  const authData = buildStoredAuthData({
    accountId: 'workspace-a',
    email: 'person@example.com',
    subject: 'user-sub-1',
  })

  try {
    await writeStoredCodexAuthData(authData, { homeDirectory })
    const authFilePath = path.join(homeDirectory, '.echosphere', 'config', 'providers', 'codex', 'auth.json')
    assert.equal(await fs.readFile(authFilePath, 'utf8'), `${JSON.stringify(authData, null, 2)}`)

    const storedAuthData = await readStoredCodexAuthData({ homeDirectory })
    assert.deepEqual(storedAuthData, authData)

    const { account } = await upsertStoredCodexAccount(authData, undefined, { homeDirectory })
    const accountFilePath = getStoredCodexAccountFilePath(authData.tokens.account_key, homeDirectory)
    assert.equal(await fs.readFile(accountFilePath, 'utf8'), `${JSON.stringify(account, null, 2)}\n`)

    const storedAccount = await readStoredCodexAccount(authData.tokens.account_key, { homeDirectory })
    assert.deepEqual(storedAccount, account)

    const accounts = await listStoredCodexAccounts({ homeDirectory })
    assert.equal(accounts.length, 1)
    assert.equal(accounts[0]?.account.tokens.account_id, 'workspace-a')
    assert.equal(accounts[0]?.account.tokens.account_key, authData.tokens.account_key)
    assert.equal(accounts[0]?.account.label, 'person@example.com')
  } finally {
    await fs.rm(homeDirectory, { force: true, recursive: true })
  }
})

test('Codex auth storage keeps same Gmail accounts separate across workspaces', async () => {
  const homeDirectory = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-codex-duplicates-'))
  const firstAuthData = buildStoredAuthData({
    accountId: 'workspace-a',
    email: 'person@example.com',
    subject: 'user-sub-1',
  })
  const secondAuthData = buildStoredAuthData({
    accountId: 'workspace-b',
    email: 'person@example.com',
    subject: 'user-sub-1',
  })

  try {
    await upsertStoredCodexAccount(firstAuthData, undefined, { homeDirectory })
    await upsertStoredCodexAccount(secondAuthData, undefined, { homeDirectory })

    const accounts = await listStoredCodexAccounts({ homeDirectory })
    assert.equal(accounts.length, 2)
    const accountKeys = accounts.map(({ account }) => account.tokens.account_key)
    assert.equal(new Set(accountKeys).size, 2)
    assert.equal(accounts.every(({ account }) => account.email === 'person@example.com'), true)
  } finally {
    await fs.rm(homeDirectory, { force: true, recursive: true })
  }
})
