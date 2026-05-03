import { extractCodexAccountIdFromTokenPair, extractCodexAccountKeyFromTokenPair, parseCodexIdTokenClaims } from './jwt'
import type { StoredCodexAuthData } from './store'

const CODEX_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const REFRESH_BUFFER_MS = 60_000

interface RefreshTokenPayload {
  access_token: string
  expires_in?: number
  id_token?: string
  refresh_token?: string
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isTokenExpiredOrNearExpiry(expiresAt: string | undefined) {
  if (!expiresAt) {
    return false
  }

  const expiresAtMs = Date.parse(expiresAt)
  if (!Number.isFinite(expiresAtMs)) {
    return false
  }

  return expiresAtMs - Date.now() <= REFRESH_BUFFER_MS
}

function parseRefreshTokenPayload(input: unknown): RefreshTokenPayload {
  if (typeof input !== 'object' || input === null) {
    throw new Error('OAuth refresh response was not a JSON object.')
  }

  const payload = input as Record<string, unknown>
  if (!hasText(payload.access_token)) {
    throw new Error('OAuth refresh response is missing access_token.')
  }

  return {
    access_token: payload.access_token,
    expires_in: typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in) ? payload.expires_in : undefined,
    id_token: hasText(payload.id_token) ? payload.id_token : undefined,
    refresh_token: hasText(payload.refresh_token) ? payload.refresh_token : undefined,
  }
}

export async function refreshCodexOAuthTokens(currentAuthData: StoredCodexAuthData): Promise<StoredCodexAuthData> {
  const body = new URLSearchParams({
    client_id: CODEX_OAUTH_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: currentAuthData.tokens.refresh_token,
    scope: 'openid profile email',
  })

  const response = await fetch(CODEX_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Codex OAuth token refresh failed (${response.status}): ${errorText}`)
  }

  const refreshPayload = parseRefreshTokenPayload((await response.json()) as unknown)
  const nextIdToken = refreshPayload.id_token ?? currentAuthData.tokens.id_token
  const accountId =
    extractCodexAccountIdFromTokenPair({
      accessToken: refreshPayload.access_token,
      idToken: nextIdToken,
    }) ?? currentAuthData.tokens.account_id
  const accountKey =
    extractCodexAccountKeyFromTokenPair({
      accessToken: refreshPayload.access_token,
      idToken: nextIdToken,
    }) ?? currentAuthData.tokens.account_key

  if (!hasText(accountId) || !hasText(accountKey)) {
    throw new Error('Unable to determine Codex account ID during token refresh.')
  }

  const now = Date.now()
  const expiresAt =
    typeof refreshPayload.expires_in === 'number' && refreshPayload.expires_in > 0
      ? new Date(now + refreshPayload.expires_in * 1000).toISOString()
      : currentAuthData.expires_at

  return {
    auth_mode: 'chatgpt',
    expires_at: expiresAt,
    last_refresh: new Date(now).toISOString(),
    tokens: {
      access_token: refreshPayload.access_token,
      account_id: accountId,
      account_key: accountKey,
      id_token: nextIdToken,
      refresh_token: refreshPayload.refresh_token ?? currentAuthData.tokens.refresh_token,
    },
  }
}

export async function refreshCodexOAuthTokensIfNeeded(authData: StoredCodexAuthData): Promise<StoredCodexAuthData> {
  const tokenClaims = parseCodexIdTokenClaims(authData.tokens.id_token)
  const expiresAt = authData.expires_at ?? tokenClaims.expiresAt ?? undefined

  if (!isTokenExpiredOrNearExpiry(expiresAt)) {
    return authData
  }

  return refreshCodexOAuthTokens(authData)
}
