import type { GitHubAuthStatus, GitHubDeviceLoginResult } from '../../src/types/chat'
import { getGitHubAppClientId } from './githubAppConfig'
import {
  pollGitHubDeviceToken,
  refreshGitHubUserAccessToken,
  requestGitHubDeviceCode,
  type GitHubDeviceCode,
} from './githubAuthApi'
import {
  readStoredGitHubTokens,
  writeStoredGitHubTokens,
  type StoredGitHubTokens,
} from './githubAuthStore'

const TOKEN_EXPIRY_SKEW_MS = 60_000
let pendingDeviceCode: GitHubDeviceCode | null = null
let pendingDeviceCodeRequest: Promise<GitHubDeviceLoginResult> | null = null
let pendingDeviceCompletion: Promise<GitHubAuthStatus> | null = null

function isNotExpired(value: string | null, now = Date.now()) {
  if (value === null) {
    return true
  }

  const expiresAt = Date.parse(value)
  return Number.isFinite(expiresAt) && expiresAt > now + TOKEN_EXPIRY_SKEW_MS
}

function toAuthStatusError(error: unknown): GitHubAuthStatus {
  return {
    kind: 'unavailable',
    message: error instanceof Error ? error.message : 'GitHub sign-in is unavailable right now.',
  }
}

async function getValidStoredTokens(): Promise<StoredGitHubTokens | null> {
  const storedTokens = await readStoredGitHubTokens()
  if (!storedTokens) {
    return null
  }

  if (isNotExpired(storedTokens.accessTokenExpiresAt)) {
    return storedTokens
  }

  if (!storedTokens.refreshToken || !isNotExpired(storedTokens.refreshTokenExpiresAt)) {
    return null
  }

  const refreshedTokens = await refreshGitHubUserAccessToken(getGitHubAppClientId(), storedTokens.refreshToken)
  const nextTokens: StoredGitHubTokens = {
    accessToken: refreshedTokens.accessToken,
    accessTokenExpiresAt: refreshedTokens.accessTokenExpiresAt,
    refreshToken: refreshedTokens.refreshToken ?? storedTokens.refreshToken,
    refreshTokenExpiresAt: refreshedTokens.refreshTokenExpiresAt ?? storedTokens.refreshTokenExpiresAt,
  }
  await writeStoredGitHubTokens(nextTokens)
  return nextTokens
}

export async function getGitHubAccessToken() {
  const tokens = await getValidStoredTokens()
  if (!tokens) {
    throw new Error('Sign in with GitHub before publishing this repository.')
  }

  return tokens.accessToken
}

export async function getGitHubAuthStatus(): Promise<GitHubAuthStatus> {
  try {
    const tokens = await getValidStoredTokens()
    if (tokens) {
      return { kind: 'authenticated' }
    }

    return { kind: 'not-authenticated', message: 'Sign in with GitHub before publishing.' }
  } catch (error) {
    return toAuthStatusError(error)
  }
}

export async function connectGitHub(): Promise<GitHubDeviceLoginResult> {
  if (pendingDeviceCodeRequest) {
    return pendingDeviceCodeRequest
  }

  pendingDeviceCodeRequest = (async () => {
    const deviceCode = await requestGitHubDeviceCode(getGitHubAppClientId())
    pendingDeviceCode = deviceCode
    const { clipboard, shell } = await import('electron')
    clipboard.writeText(deviceCode.userCode)
    await shell.openExternal(deviceCode.verificationUri)

    return {
      expiresAt: deviceCode.expiresAt.toISOString(),
      userCode: deviceCode.userCode,
      verificationUri: deviceCode.verificationUri,
    }
  })().finally(() => {
    pendingDeviceCodeRequest = null
  })

  return pendingDeviceCodeRequest
}

export async function completeGitHubDeviceLogin(): Promise<GitHubAuthStatus> {
  if (pendingDeviceCompletion) {
    return pendingDeviceCompletion
  }

  if (!pendingDeviceCode) {
    throw new Error('Start GitHub connection before completing sign-in.')
  }

  const deviceCode = pendingDeviceCode
  const deviceCompletion = (async (): Promise<GitHubAuthStatus> => {
    try {
      const tokens = await pollGitHubDeviceToken(getGitHubAppClientId(), deviceCode)
      await writeStoredGitHubTokens(tokens)
      return { kind: 'authenticated' }
    } catch (error) {
      return toAuthStatusError(error)
    } finally {
      pendingDeviceCode = null
    }
  })().finally(() => {
    pendingDeviceCompletion = null
  })

  pendingDeviceCompletion = deviceCompletion
  return deviceCompletion
}
