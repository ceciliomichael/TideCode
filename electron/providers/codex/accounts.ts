import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseCodexIdTokenClaims } from './jwt'
import { getCodexAccountsDirectoryPath, getLegacyStoredCodexAccountFilePath, getStoredCodexAccountFilePath } from './paths'
import type { StoredCodexAuthData } from './store'
import { parseStoredCodexAuthData } from './store'

import { writeJsonFileAtomic } from '../../settings/fileStore'

export interface StoredCodexAccountData extends StoredCodexAuthData {
  email: string | null
  label: string
  storage_key: string
  updated_at: string
}

export interface CodexAccountStorageOptions {
  homeDirectory?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

async function ensureCodexAccountsDirectory(homeDirectory?: string) {
  await fs.mkdir(getCodexAccountsDirectoryPath(homeDirectory), { recursive: true })
}

function toStoredCodexAccountData(input: unknown): StoredCodexAccountData | null {
  const authData = parseStoredCodexAuthData(input)
  if (!authData) {
    return null
  }

  const candidate = isRecord(input) ? input : {}
  const tokenClaims = parseCodexIdTokenClaims(authData.tokens.id_token)
  const email = tokenClaims.email
  const storageKey = authData.tokens.account_key

  const label = hasText(candidate.label) ? candidate.label.trim() : email ?? authData.tokens.account_id
  const updatedAt = hasText(candidate.updated_at) ? candidate.updated_at : new Date().toISOString()

  return {
    ...authData,
    email,
    label,
    storage_key: storageKey,
    updated_at: updatedAt,
  }
}

export async function readStoredCodexAccount(
  accountKey: string,
  options?: CodexAccountStorageOptions,
): Promise<StoredCodexAccountData | null> {
  const filePath = getStoredCodexAccountFilePath(accountKey, options?.homeDirectory)
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return toStoredCodexAccountData(JSON.parse(raw) as unknown)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const accounts = await listStoredCodexAccounts(options)
      const legacyMatch = accounts.find(({ account }) => account.tokens.account_key === accountKey)

      return legacyMatch?.account ?? null
    }

    if (error instanceof SyntaxError) {
      console.warn(`Ignoring corrupted Codex account file at ${filePath}`)
      const accounts = await listStoredCodexAccounts(options)
      const legacyMatch = accounts.find(({ account }) => account.tokens.account_key === accountKey)

      return legacyMatch?.account ?? null
    }

    throw error
  }
}

export async function listStoredCodexAccounts(
  options?: CodexAccountStorageOptions,
): Promise<Array<{ filePath: string; account: StoredCodexAccountData }>> {
  await ensureCodexAccountsDirectory(options?.homeDirectory)
  const entries = await fs.readdir(getCodexAccountsDirectoryPath(options?.homeDirectory), { withFileTypes: true })

  const accountFiles = entries.filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.json')
  const results = await Promise.all(
    accountFiles.map(async (entry) => {
      const filePath = path.join(getCodexAccountsDirectoryPath(options?.homeDirectory), entry.name)
      try {
        const raw = await fs.readFile(filePath, 'utf8')
        const parsed = toStoredCodexAccountData(JSON.parse(raw) as unknown)
        if (!parsed) {
          return null
        }

        const stat = await fs.stat(filePath)
        return { filePath, account: parsed, modifiedAtMs: stat.mtimeMs }
      } catch {
        return null
      }
    }),
  )

  const selectedAccounts = new Map<string, { filePath: string; account: StoredCodexAccountData; modifiedAtMs: number }>()

  for (const result of results) {
    if (!result) {
      continue
    }

    const existing = selectedAccounts.get(result.account.storage_key)
    if (!existing || result.modifiedAtMs >= existing.modifiedAtMs) {
      selectedAccounts.set(result.account.storage_key, result)
    }
  }

  return Array.from(selectedAccounts.values()).map(({ filePath, account }) => ({ filePath, account }))
}

export async function upsertStoredCodexAccount(
  authData: StoredCodexAuthData,
  label?: string,
  options?: CodexAccountStorageOptions,
) {
  const tokenClaims = parseCodexIdTokenClaims(authData.tokens.id_token)
  const email = tokenClaims.email
  const resolvedLabel = label && label.trim().length > 0 ? label.trim() : email ?? authData.tokens.account_id
  const storageKey = authData.tokens.account_key
  const account: StoredCodexAccountData = {
    ...authData,
    email,
    label: resolvedLabel,
    storage_key: storageKey,
    updated_at: new Date().toISOString(),
  }

  const filePath = getStoredCodexAccountFilePath(storageKey, options?.homeDirectory)
  await ensureCodexAccountsDirectory(options?.homeDirectory)
  await writeJsonFileAtomic(filePath, `${JSON.stringify(account, null, 2)}\n`)

  const legacyFilePath = getLegacyStoredCodexAccountFilePath(authData.tokens.account_id, options?.homeDirectory)
  if (legacyFilePath !== filePath) {
    await fs.unlink(legacyFilePath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    })
  }

  return { filePath, account }
}

export async function deleteStoredCodexAccount(accountKey: string, options?: CodexAccountStorageOptions) {
  const filePath = getStoredCodexAccountFilePath(accountKey, options?.homeDirectory)
  await fs.unlink(filePath).catch(async (error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }

    const accounts = await listStoredCodexAccounts(options)
    const legacyMatch = accounts.find(({ account }) => account.tokens.account_key === accountKey)

    if (legacyMatch) {
      await fs.unlink(legacyMatch.filePath)
      return
    }

    throw error
  })
}
