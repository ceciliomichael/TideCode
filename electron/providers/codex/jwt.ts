import { Buffer } from 'node:buffer'

interface CodexIdTokenClaims {
  account_id?: string
  accountId?: string
  chatgpt_account_id?: string
  sub?: string
  organizations?: Array<
    | {
        id?: string
      }
    | string
  >
  email?: string
  exp?: number
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeBase64Url(input: string) {
  const encoded = input.replace(/-/g, '+').replace(/_/g, '/')
  const missingPadding = encoded.length % 4

  if (missingPadding === 0) {
    return encoded
  }

  return `${encoded}${'='.repeat(4 - missingPadding)}`
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length < 2) {
    return null
  }

  try {
    const payload = Buffer.from(normalizeBase64Url(parts[1]), 'base64').toString('utf8')
    const claimsCandidate = JSON.parse(payload) as unknown
    return isRecord(claimsCandidate) ? claimsCandidate : null
  } catch {
    return null
  }
}

function readClaimAccountId(claims: Record<string, unknown>): string | null {
  const directCandidates = [claims.account_id, claims.accountId, claims.chatgpt_account_id]

  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }

  const authClaimsCandidate = claims['https://api.openai.com/auth']
  if (isRecord(authClaimsCandidate)) {
    const authAccountId = authClaimsCandidate.chatgpt_account_id
    if (typeof authAccountId === 'string' && authAccountId.trim().length > 0) {
      return authAccountId.trim()
    }
  }

  const organizationsCandidate = claims.organizations
  if (Array.isArray(organizationsCandidate)) {
    for (const organizationCandidate of organizationsCandidate) {
      if (typeof organizationCandidate === 'string' && organizationCandidate.trim().length > 0) {
        return organizationCandidate.trim()
      }

      if (
        isRecord(organizationCandidate) &&
        typeof organizationCandidate.id === 'string' &&
        organizationCandidate.id.trim().length > 0
      ) {
        return organizationCandidate.id.trim()
      }
    }
  }

  return null
}

function readClaimIdentitySuffix(claims: Record<string, unknown>): string | null {
  const directCandidates = [claims.sub]

  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }

  const typedClaims = claims as CodexIdTokenClaims
  if (typeof typedClaims.email === 'string' && typedClaims.email.trim().length > 0) {
    return typedClaims.email.trim()
  }

  return null
}

function readClaimAccountKey(claims: Record<string, unknown>): string | null {
  const accountId = readClaimAccountId(claims)
  const identitySuffix = readClaimIdentitySuffix(claims)

  if (accountId && identitySuffix) {
    return `${accountId}::${identitySuffix}`
  }

  return accountId ?? identitySuffix
}

function extractClaimAccountId(token: string): string | null {
  const claims = parseJwtPayload(token)
  if (!claims) {
    return null
  }

  return readClaimAccountId(claims)
}

export function parseCodexIdTokenClaims(idToken: string): {
  accountId: string | null
  accountKey: string | null
  email: string | null
  expiresAt: string | null
} {
  const claims = parseJwtPayload(idToken)
  if (!claims) {
    return {
      accountId: null,
      accountKey: null,
      email: null,
      expiresAt: null,
    }
  }

  const typedClaims = claims as CodexIdTokenClaims
  const accountId = readClaimAccountId(claims)
  const accountKey = readClaimAccountKey(claims)
  const email = typeof typedClaims.email === 'string' ? typedClaims.email : null
  const expiresAt =
    typeof typedClaims.exp === 'number' && Number.isFinite(typedClaims.exp)
      ? new Date(typedClaims.exp * 1000).toISOString()
      : null

  return {
    accountId,
    accountKey,
    email,
    expiresAt,
  }
}

export function extractCodexAccountIdFromTokenPair(input: { idToken: string; accessToken?: string | null }) {
  return extractClaimAccountId(input.idToken) ?? (input.accessToken ? extractClaimAccountId(input.accessToken) : null)
}

export function extractCodexAccountKeyFromTokenPair(input: { idToken: string; accessToken?: string | null }) {
  const idTokenClaims = parseJwtPayload(input.idToken)
  const accessTokenClaims = input.accessToken ? parseJwtPayload(input.accessToken) : null

  const accountId = (idTokenClaims && readClaimAccountId(idTokenClaims)) ?? (accessTokenClaims && readClaimAccountId(accessTokenClaims))
  const identitySuffix =
    (idTokenClaims && readClaimIdentitySuffix(idTokenClaims)) ?? (accessTokenClaims && readClaimIdentitySuffix(accessTokenClaims))

  if (accountId && identitySuffix) {
    return `${accountId}::${identitySuffix}`
  }

  return accountId ?? identitySuffix ?? null
}
