import { runCodexOAuthFlow } from './oauth'
import {
  deleteStoredCodexAuthData,
  readStoredCodexAuthData,
  toCodexProviderStatus,
  writeStoredCodexAuthData,
  type StoredCodexAuthData,
} from './store'
import { deleteStoredCodexAccount, listStoredCodexAccounts, readStoredCodexAccount, upsertStoredCodexAccount } from './accounts'
import { parseCodexIdTokenClaims } from './jwt'
import type { CodexAccountSummary, CodexUsageSnapshot } from '../../../src/types/chat'
import { refreshCodexOAuthTokensIfNeeded } from './refresh'
import { fetchCodexUsageSnapshot } from './usage'
import { selectCodexRotationAccountKey } from './rotation'
import { emitProvidersStateChanged } from '../events'

const USAGE_FETCH_TIMEOUT_MS = 10_000
const cachedAccountUsages = new Map<string, CodexUsageSnapshot>()

async function fetchUsageWithTimeout(input: { accessToken: string; accountId: string }) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), USAGE_FETCH_TIMEOUT_MS)

  try {
    return await fetchCodexUsageSnapshot({
      accessToken: input.accessToken,
      accountId: input.accountId,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

async function activateStoredCodexAccount(accountKey: string) {
  const storedAccount = await readStoredCodexAccount(accountKey)

  if (!storedAccount) {
    throw new Error(`Codex account not found: ${accountKey}`)
  }

  const refreshed = await refreshCodexOAuthTokensIfNeeded(storedAccount)
  await writeStoredCodexAuthData(refreshed)
  await upsertStoredCodexAccount(refreshed, storedAccount.label)
  return refreshed
}

export async function getCodexProviderStatus(hydrate = false, options?: { homeDirectory?: string }) {
  const activeAuthData = await readStoredCodexAuthData(options)

  if (activeAuthData) {
    const existingAccount = await readStoredCodexAccount(activeAuthData.tokens.account_key, options)
    await upsertStoredCodexAccount(activeAuthData, existingAccount?.label, options)
  }

  const storedAccounts = await listStoredCodexAccounts(options).catch(() => [])
  const activeAccountKey = activeAuthData?.tokens.account_key ?? null

  const accounts = await Promise.all(
    storedAccounts.map(async ({ account }) => {
      let resolvedAccount = account
      let usage: CodexAccountSummary['usage'] = cachedAccountUsages.get(account.tokens.account_key) ?? null

      if (hydrate) {
        try {
          const nextAuthData = await refreshCodexOAuthTokensIfNeeded(account)
          if (
            nextAuthData.tokens.access_token !== account.tokens.access_token ||
            nextAuthData.tokens.refresh_token !== account.tokens.refresh_token ||
            nextAuthData.tokens.id_token !== account.tokens.id_token ||
            nextAuthData.expires_at !== account.expires_at ||
            nextAuthData.last_refresh !== account.last_refresh
          ) {
            resolvedAccount = (await upsertStoredCodexAccount(nextAuthData, account.label, options)).account

            if (nextAuthData.tokens.account_key === activeAccountKey) {
              await writeStoredCodexAuthData(nextAuthData, options)
            }
          }
        } catch {
          // Ignore refresh failures for non-active accounts; the UI can still surface the stored data.
        }

        try {
          const fetchedUsage = await fetchUsageWithTimeout({
            accessToken: resolvedAccount.tokens.access_token,
            accountId: resolvedAccount.tokens.account_id,
          })
          usage = fetchedUsage
          cachedAccountUsages.set(resolvedAccount.tokens.account_key, fetchedUsage)
        } catch {
          // Retain cached usage if fetch timed out or failed temporarily
          usage = cachedAccountUsages.get(resolvedAccount.tokens.account_key) ?? null
        }
      }

      const tokenClaims = parseCodexIdTokenClaims(resolvedAccount.tokens.id_token)
      const tokenExpiresAt = resolvedAccount.expires_at ?? tokenClaims.expiresAt ?? null

      const summary: CodexAccountSummary = {
        accountId: resolvedAccount.tokens.account_id,
        accountKey: resolvedAccount.tokens.account_key,
        email: tokenClaims.email,
        isActive: resolvedAccount.tokens.account_key === activeAccountKey,
        label: resolvedAccount.label,
        lastRefreshAt: resolvedAccount.last_refresh ?? null,
        tokenExpiresAt,
        usage,
      }

      return summary
    }),
  )

  accounts.sort((left, right) => {
    if (left.isActive !== right.isActive) {
      return left.isActive ? -1 : 1
    }

    return left.label.localeCompare(right.label)
  })

  return toCodexProviderStatus(activeAuthData, accounts, options)
}

export async function maybeRotateCodexAccountForChat() {
  const providerStatus = await getCodexProviderStatus(true)
  emitProvidersStateChanged()

  if (!providerStatus.isAuthenticated || !providerStatus.accountKey) {
    return null
  }

  const targetAccountKey = selectCodexRotationAccountKey(providerStatus.accounts, providerStatus.accountKey)

  if (!targetAccountKey || targetAccountKey === providerStatus.accountKey) {
    return readStoredCodexAuthData()
  }

  const nextAuthData = await activateStoredCodexAccount(targetAccountKey)
  emitProvidersStateChanged()
  return nextAuthData
}

export async function connectCodexProviderWithOAuth(openExternal: (url: string) => Promise<void>) {
  const existingAuthData = await readStoredCodexAuthData()
  if (existingAuthData) {
    const existingAccount = await readStoredCodexAccount(existingAuthData.tokens.account_key)
    await upsertStoredCodexAccount(existingAuthData, existingAccount?.label)
  }

  const authResult = await runCodexOAuthFlow(openExternal)

  const nextAuthData: StoredCodexAuthData = {
    auth_mode: 'chatgpt',
    expires_at: authResult.expiresAt ?? undefined,
    last_refresh: authResult.lastRefreshAt,
    tokens: {
      access_token: authResult.accessToken,
      account_id: authResult.accountId,
      account_key: authResult.accountKey,
      id_token: authResult.idToken,
      refresh_token: authResult.refreshToken,
    },
  }

  await writeStoredCodexAuthData(nextAuthData)
  await upsertStoredCodexAccount(nextAuthData)

  return getCodexProviderStatus(true)
}

export async function addCodexAccountProviderWithOAuth(openExternal: (url: string) => Promise<void>) {
  return connectCodexProviderWithOAuth(openExternal)
}

export async function disconnectCodexProvider() {
  await deleteStoredCodexAuthData()
  cachedAccountUsages.clear()
  return getCodexProviderStatus()
}

export async function switchCodexAccount(accountKey: string) {
  await activateStoredCodexAccount(accountKey)
  return getCodexProviderStatus(true)
}

export async function removeCodexAccountProvider(accountKey: string) {
  const activeAuthData = await readStoredCodexAuthData()
  cachedAccountUsages.delete(accountKey)
  
  try {
    await deleteStoredCodexAccount(accountKey)
  } catch {
    // Ignore error if account already deleted or missing
  }
  
  if (activeAuthData?.tokens.account_key === accountKey) {
    const remainingAccounts = await listStoredCodexAccounts().catch(() => [])
    if (remainingAccounts.length > 0) {
      await activateStoredCodexAccount(remainingAccounts[0].account.tokens.account_key)
    } else {
      await deleteStoredCodexAuthData()
    }
  }

  return getCodexProviderStatus(true)
}
