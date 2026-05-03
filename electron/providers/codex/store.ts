import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { CodexAccountSummary, CodexProviderConnectionStatus } from '../../../src/types/chat'
import { extractCodexAccountIdFromTokenPair, extractCodexAccountKeyFromTokenPair, parseCodexIdTokenClaims } from './jwt'
import { getCodexAuthFilePath } from './paths'

interface CodexAuthTokens {
  access_token: string
  account_id: string
  account_key: string
  id_token: string
  refresh_token: string
}

export type CodexAuthMode = 'chatgpt'

export interface StoredCodexAuthData {
  auth_mode: CodexAuthMode
  expires_at?: string
  last_refresh: string
  tokens: CodexAuthTokens
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export interface CodexStorageOptions {
  homeDirectory?: string
}

export function parseStoredCodexAuthData(input: unknown): StoredCodexAuthData | null {
  if (!isRecord(input)) {
    return null
  }

  const tokensCandidate = input.tokens
  if (!isRecord(tokensCandidate)) {
    return null
  }

  if (
    !hasText(tokensCandidate.id_token) ||
    !hasText(tokensCandidate.access_token) ||
    !hasText(tokensCandidate.refresh_token)
  ) {
    return null
  }

  const accountId =
    hasText(tokensCandidate.account_id)
      ? tokensCandidate.account_id
      : extractCodexAccountIdFromTokenPair({
          accessToken: hasText(tokensCandidate.access_token) ? tokensCandidate.access_token : undefined,
          idToken: tokensCandidate.id_token,
        })
  if (!hasText(accountId)) {
    return null
  }

  const accountKey =
    hasText(tokensCandidate.account_key)
      ? tokensCandidate.account_key
      : extractCodexAccountKeyFromTokenPair({
          accessToken: hasText(tokensCandidate.access_token) ? tokensCandidate.access_token : undefined,
          idToken: tokensCandidate.id_token,
        }) ?? accountId

  const lastRefresh = hasText(input.last_refresh) ? input.last_refresh : new Date().toISOString()
  const expiresAt = hasText(input.expires_at) ? input.expires_at : undefined
  return {
    auth_mode: 'chatgpt',
    expires_at: expiresAt,
    last_refresh: lastRefresh,
    tokens: {
      access_token: tokensCandidate.access_token,
      account_id: accountId,
      account_key: accountKey,
      id_token: tokensCandidate.id_token,
      refresh_token: tokensCandidate.refresh_token,
    },
  }
}

async function ensureCodexAuthDirectory(homeDirectory?: string) {
  await fs.mkdir(path.dirname(getCodexAuthFilePath(homeDirectory)), { recursive: true })
}

export async function readStoredCodexAuthData(options?: CodexStorageOptions) {
  try {
    const raw = await fs.readFile(getCodexAuthFilePath(options?.homeDirectory), 'utf8')
    const parsed = parseStoredCodexAuthData(JSON.parse(raw) as unknown)

    if (!parsed) {
      throw new Error('Unsupported Codex auth file format.')
    }

    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    throw error
  }
}

export async function writeStoredCodexAuthData(data: StoredCodexAuthData, options?: CodexStorageOptions) {
  await ensureCodexAuthDirectory(options?.homeDirectory)
  await fs.writeFile(getCodexAuthFilePath(options?.homeDirectory), JSON.stringify(data, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })
}

export async function deleteStoredCodexAuthData(options?: CodexStorageOptions) {
  try {
    await fs.unlink(getCodexAuthFilePath(options?.homeDirectory))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

export function toCodexProviderStatus(
  authData: StoredCodexAuthData | null,
  accounts: CodexAccountSummary[],
  options?: CodexStorageOptions,
): CodexProviderConnectionStatus {
  if (!authData) {
    return {
      accountId: null,
      accountKey: null,
      authFilePath: getCodexAuthFilePath(options?.homeDirectory),
      email: null,
      accounts,
      isAuthenticated: false,
      lastRefreshAt: null,
      tokenExpiresAt: null,
    }
  }

  const tokenClaims = parseCodexIdTokenClaims(authData.tokens.id_token)
  const tokenExpiresAt = authData.expires_at ?? tokenClaims.expiresAt
  const accountId = authData.tokens.account_id || tokenClaims.accountId
  const accountKey = authData.tokens.account_key || tokenClaims.accountKey

  return {
    accountId,
    accountKey,
    authFilePath: getCodexAuthFilePath(options?.homeDirectory),
    email: tokenClaims.email,
    accounts,
    isAuthenticated: true,
    lastRefreshAt: authData.last_refresh,
    tokenExpiresAt,
  }
}
