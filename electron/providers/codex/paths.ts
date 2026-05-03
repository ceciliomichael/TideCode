import electron from 'electron'
import path from 'node:path'

const CODEX_STORAGE_ROOT_SEGMENTS = ['.echosphere', 'config', 'providers', 'codex'] as const

function resolveHomeDirectory(homeDirectory?: string) {
  const normalizedHomeDirectory = homeDirectory?.trim()
  if (normalizedHomeDirectory && normalizedHomeDirectory.length > 0) {
    return normalizedHomeDirectory
  }

  const app = (electron as { app?: { getPath: (name: string) => string } }).app
  if (!app) {
    throw new Error('Electron app is not available.')
  }

  return app.getPath('home')
}

export function getCodexStorageRootPath(homeDirectory?: string) {
  return path.join(resolveHomeDirectory(homeDirectory), ...CODEX_STORAGE_ROOT_SEGMENTS)
}

export function getCodexAuthFilePath(homeDirectory?: string) {
  return path.join(getCodexStorageRootPath(homeDirectory), 'auth.json')
}

export function getCodexAccountsDirectoryPath(homeDirectory?: string) {
  return path.join(getCodexStorageRootPath(homeDirectory), 'accounts')
}

export function getStoredCodexAccountFilePath(accountKey: string, homeDirectory?: string) {
  const normalizedAccountKey = accountKey.trim()
  if (normalizedAccountKey.length === 0) {
    throw new Error('Codex account key is required.')
  }

  return path.join(getCodexAccountsDirectoryPath(homeDirectory), `${encodeURIComponent(normalizedAccountKey)}.json`)
}

export function getLegacyStoredCodexAccountFilePath(accountId: string, homeDirectory?: string) {
  const normalizedAccountId = accountId.trim()
  if (normalizedAccountId.length === 0) {
    throw new Error('Codex account ID is required.')
  }

  return path.join(getCodexAccountsDirectoryPath(homeDirectory), `${normalizedAccountId}.json`)
}
