import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { extractCodexAccountIdFromTokenPair, extractCodexAccountKeyFromTokenPair } from './jwt'

const CODEX_OAUTH_AUTHORIZATION_URL = 'https://auth.openai.com/oauth/authorize'
const CODEX_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_OAUTH_REDIRECT_URI = 'http://localhost:1455/auth/callback'
const CODEX_OAUTH_SCOPE = 'openid email profile offline_access'
const CODEX_OAUTH_ORIGINATOR = 'echosphere'
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000

interface OAuthTokenPayload {
  access_token: string
  expires_in: number | null
  id_token: string
  refresh_token: string
}

interface OAuthResult {
  accessToken: string
  accountId: string
  accountKey: string
  expiresAt: string | null
  idToken: string
  lastRefreshAt: string
  refreshToken: string
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function toBase64Url(input: Buffer) {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function createPkcePair() {
  const verifier = toBase64Url(randomBytes(64))
  const challenge = toBase64Url(createHash('sha256').update(verifier).digest())

  return {
    challenge,
    verifier,
  }
}

function createOAuthState() {
  return toBase64Url(randomBytes(24))
}

export function createAuthorizationUrl(codeChallenge: string, state: string) {
  const url = new URL(CODEX_OAUTH_AUTHORIZATION_URL)
  url.searchParams.set('client_id', CODEX_OAUTH_CLIENT_ID)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', CODEX_OAUTH_REDIRECT_URI)
  url.searchParams.set('scope', CODEX_OAUTH_SCOPE)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('prompt', 'login')
  url.searchParams.set('id_token_add_organizations', 'true')
  url.searchParams.set('codex_cli_simplified_flow', 'true')
  url.searchParams.set('originator', CODEX_OAUTH_ORIGINATOR)
  return url.toString()
}

function createCallbackHtml(title: string, description: string) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}</title>
    <style>
      body { margin: 0; padding: 0; font-family: ui-sans-serif, -apple-system, Segoe UI, sans-serif; background: #f6f7fb; color: #101011; }
      main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      section { width: min(560px, 100%); background: #ffffff; border: 1px solid #eceff5; border-radius: 16px; box-shadow: 0 10px 30px rgba(16, 16, 17, 0.08); padding: 24px; }
      h1 { margin: 0; font-size: 20px; }
      p { margin: 10px 0 0; line-height: 1.6; color: #606266; font-size: 14px; }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>${title}</h1>
        <p>${description}</p>
      </section>
    </main>
  </body>
</html>`
}

async function waitForAuthorizationCode(authUrl: string, expectedState: string, openExternal: (url: string) => Promise<void>) {
  return new Promise<string>((resolve, reject) => {
    const server = createServer((request, response) => {
      const requestUrl = request.url

      if (!requestUrl) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('Missing callback URL.')
        return
      }

      const callbackUrl = new URL(requestUrl, CODEX_OAUTH_REDIRECT_URI)

      if (callbackUrl.pathname !== '/auth/callback') {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('Not found.')
        return
      }

      const error = callbackUrl.searchParams.get('error')
      if (error) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(
          createCallbackHtml('Codex sign-in failed', 'Authentication was not completed. Return to EchoSphere and try again.'),
        )
        finish(new Error(`OAuth authorization failed: ${error}`))
        return
      }

      const state = callbackUrl.searchParams.get('state')
      if (state !== expectedState) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(
          createCallbackHtml('Invalid sign-in state', 'This sign-in request is no longer valid. Return to EchoSphere and retry.'),
        )
        finish(new Error('OAuth state mismatch.'))
        return
      }

      const code = callbackUrl.searchParams.get('code')
      if (!hasText(code)) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(
          createCallbackHtml('Missing authorization code', 'Authentication could not be completed. Return to EchoSphere and try again.'),
        )
        finish(new Error('OAuth callback did not include an authorization code.'))
        return
      }

      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(
        createCallbackHtml('Codex connected', 'Authentication succeeded. Return to EchoSphere to continue.'),
      )
      finish(undefined, code)
    })

    const timeoutId = setTimeout(() => {
      finish(new Error('Timed out waiting for the Codex OAuth callback.'))
    }, OAUTH_TIMEOUT_MS)
    let isSettled = false

    function finish(error?: Error, code?: string) {
      if (isSettled) {
        return
      }

      isSettled = true
      clearTimeout(timeoutId)
      server.close()

      if (error) {
        reject(error)
        return
      }

      if (!code) {
        reject(new Error('OAuth callback completed without a code.'))
        return
      }

      resolve(code)
    }

    server.once('error', (error) => {
      finish(new Error(`Failed to start OAuth callback listener: ${(error as Error).message}`))
    })

    server.listen(1455, 'localhost', () => {
      void openExternal(authUrl).catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : 'Unknown error'
        finish(new Error(`Failed to open browser for OAuth: ${reason}`))
      })
    })
  })
}

function parseOAuthTokenPayload(input: unknown): OAuthTokenPayload {
  if (typeof input !== 'object' || input === null) {
    throw new Error('OAuth token response was not a JSON object.')
  }

  const payload = input as Record<string, unknown>
  if (!hasText(payload.access_token) || !hasText(payload.refresh_token) || !hasText(payload.id_token)) {
    throw new Error('OAuth token response is missing required token fields.')
  }

  return {
    access_token: payload.access_token,
    expires_in: typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in) ? payload.expires_in : null,
    id_token: payload.id_token,
    refresh_token: payload.refresh_token,
  }
}

async function exchangeAuthorizationCodeForTokens(code: string, codeVerifier: string) {
  const body = new URLSearchParams({
    client_id: CODEX_OAUTH_CLIENT_ID,
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: CODEX_OAUTH_REDIRECT_URI,
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
    throw new Error(`Codex OAuth token exchange failed (${response.status}): ${errorText}`)
  }

  return parseOAuthTokenPayload((await response.json()) as unknown)
}

export async function runCodexOAuthFlow(openExternal: (url: string) => Promise<void>): Promise<OAuthResult> {
  const pkce = createPkcePair()
  const state = createOAuthState()
  const authUrl = createAuthorizationUrl(pkce.challenge, state)
  const authorizationCode = await waitForAuthorizationCode(authUrl, state, openExternal)
  const tokenPayload = await exchangeAuthorizationCodeForTokens(authorizationCode, pkce.verifier)
  const accountId = extractCodexAccountIdFromTokenPair({
    accessToken: tokenPayload.access_token,
    idToken: tokenPayload.id_token,
  })
  const accountKey = extractCodexAccountKeyFromTokenPair({
    accessToken: tokenPayload.access_token,
    idToken: tokenPayload.id_token,
  })

  if (!hasText(accountId) || !hasText(accountKey)) {
    throw new Error('Codex OAuth did not return a usable account identifier.')
  }

  const now = new Date()
  const expiresAt =
    typeof tokenPayload.expires_in === 'number' && tokenPayload.expires_in > 0
      ? new Date(now.getTime() + tokenPayload.expires_in * 1000).toISOString()
      : null

  return {
    accessToken: tokenPayload.access_token,
    accountId,
    accountKey,
    expiresAt,
    idToken: tokenPayload.id_token,
    lastRefreshAt: now.toISOString(),
    refreshToken: tokenPayload.refresh_token,
  }
}
