import { fetchGitHub } from './githubHttp'

const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code'
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'

export interface GitHubDeviceCode {
  deviceCode: string
  expiresAt: Date
  intervalSeconds: number
  userCode: string
  verificationUri: string
}

export interface GitHubUserAccessToken {
  accessToken: string
  accessTokenExpiresAt: string | null
  refreshToken: string | null
  refreshTokenExpiresAt: string | null
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parsePositiveSeconds(value: unknown, fallback: number | null = null) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

async function postForm(url: string, body: URLSearchParams): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetchGitHub(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })
  } catch {
    throw new Error('Could not connect to GitHub. Check your internet connection and try again.')
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('GitHub returned an invalid authentication response.')
  }

  if (typeof payload !== 'object' || payload === null) {
    throw new Error('GitHub returned an invalid authentication response.')
  }

  const record = payload as Record<string, unknown>
  if (!response.ok && !hasText(record.error)) {
    throw new Error(`GitHub authentication failed (${response.status}).`)
  }

  return record
}

function parseDeviceCodeResponse(payload: Record<string, unknown>): GitHubDeviceCode {
  if (
    !hasText(payload.device_code) ||
    !hasText(payload.user_code) ||
    !hasText(payload.verification_uri) ||
    !parsePositiveSeconds(payload.expires_in) ||
    !parsePositiveSeconds(payload.interval)
  ) {
    throw new Error('GitHub returned an incomplete device sign-in response.')
  }

  const expiresInSeconds = parsePositiveSeconds(payload.expires_in)!
  const intervalSeconds = parsePositiveSeconds(payload.interval)!

  return {
    deviceCode: payload.device_code,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    intervalSeconds,
    userCode: payload.user_code,
    verificationUri: payload.verification_uri,
  }
}

export async function requestGitHubDeviceCode(clientId: string) {
  const payload = await postForm(
    GITHUB_DEVICE_CODE_URL,
    new URLSearchParams({
      client_id: clientId,
    }),
  )

  if (hasText(payload.error)) {
    throw new Error(payload.error_description && hasText(payload.error_description)
      ? payload.error_description
      : 'GitHub could not start the sign-in flow.')
  }

  return parseDeviceCodeResponse(payload)
}

function parseUserAccessToken(payload: Record<string, unknown>): GitHubUserAccessToken | null {
  if (!hasText(payload.access_token)) {
    return null
  }

  const now = Date.now()
  const accessTokenExpiresIn = parsePositiveSeconds(payload.expires_in)
  const refreshTokenExpiresIn = parsePositiveSeconds(payload.refresh_token_expires_in)

  return {
    accessToken: payload.access_token,
    accessTokenExpiresAt: accessTokenExpiresIn ? new Date(now + accessTokenExpiresIn * 1000).toISOString() : null,
    refreshToken: hasText(payload.refresh_token) ? payload.refresh_token : null,
    refreshTokenExpiresAt: refreshTokenExpiresIn ? new Date(now + refreshTokenExpiresIn * 1000).toISOString() : null,
  }
}

function getGitHubTokenError(payload: Record<string, unknown>) {
  const errorCode = hasText(payload.error) ? payload.error : 'unknown_error'
  const description = hasText(payload.error_description) ? payload.error_description : 'GitHub did not complete sign-in.'
  return { errorCode, description }
}

export async function pollGitHubDeviceToken(
  clientId: string,
  deviceCode: GitHubDeviceCode,
): Promise<GitHubUserAccessToken> {
  let intervalSeconds = deviceCode.intervalSeconds

  while (Date.now() < deviceCode.expiresAt.getTime()) {
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000))
    const payload = await postForm(
      GITHUB_ACCESS_TOKEN_URL,
      new URLSearchParams({
        client_id: clientId,
        device_code: deviceCode.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    )

    const tokens = parseUserAccessToken(payload)
    if (tokens) {
      return tokens
    }

    const { errorCode, description } = getGitHubTokenError(payload)
    if (errorCode === 'authorization_pending') {
      continue
    }
    if (errorCode === 'slow_down') {
      intervalSeconds += 5
      continue
    }
    if (errorCode === 'expired_token' || errorCode === 'token_expired') {
      throw new Error('The GitHub sign-in code expired. Start the connection again.')
    }
    if (errorCode === 'access_denied') {
      throw new Error('GitHub sign-in was cancelled.')
    }
    if (errorCode === 'device_flow_disabled') {
      throw new Error('GitHub Device Flow is not enabled for the TideCode GitHub App.')
    }

    throw new Error(`GitHub sign-in failed: ${description}`)
  }

  throw new Error('The GitHub sign-in code expired. Start the connection again.')
}

export async function refreshGitHubUserAccessToken(clientId: string, refreshToken: string) {
  const payload = await postForm(
    GITHUB_ACCESS_TOKEN_URL,
    new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  )
  const tokens = parseUserAccessToken(payload)
  if (tokens) {
    return tokens
  }

  const { description } = getGitHubTokenError(payload)
  throw new Error(`GitHub sign-in expired: ${description}`)
}
