import { promises as fs } from 'node:fs'
import path from 'node:path'
import { writeJsonFileAtomic } from '../settings/fileStore'

const GITHUB_AUTH_FILE_NAME = 'github-app-auth.bin'

async function getElectronModule() {
  return import('electron')
}

export interface StoredGitHubTokens {
  accessToken: string
  accessTokenExpiresAt: string | null
  refreshToken: string | null
  refreshTokenExpiresAt: string | null
}

async function getGitHubAuthFilePath() {
  const { app } = await getElectronModule()
  return path.join(app.getPath('userData'), GITHUB_AUTH_FILE_NAME)
}

function isStoredGitHubTokens(input: unknown): input is StoredGitHubTokens {
  if (typeof input !== 'object' || input === null) {
    return false
  }

  const candidate = input as Record<string, unknown>
  return (
    typeof candidate.accessToken === 'string' &&
    (typeof candidate.accessTokenExpiresAt === 'string' || candidate.accessTokenExpiresAt === null) &&
    (typeof candidate.refreshToken === 'string' || candidate.refreshToken === null) &&
    (typeof candidate.refreshTokenExpiresAt === 'string' || candidate.refreshTokenExpiresAt === null)
  )
}

async function ensureEncryptionAvailable() {
  const { safeStorage } = await getElectronModule()
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure GitHub sign-in storage is unavailable on this device.')
  }
}

export async function readStoredGitHubTokens(): Promise<StoredGitHubTokens | null> {
  await ensureEncryptionAvailable()
  const { safeStorage } = await getElectronModule()
  const filePath = await getGitHubAuthFilePath()

  try {
    const encodedValue = await fs.readFile(filePath, 'utf8')
    const decryptedValue = safeStorage.decryptString(Buffer.from(encodedValue.trim(), 'base64'))
    const parsedValue: unknown = JSON.parse(decryptedValue)
    return isStoredGitHubTokens(parsedValue) ? parsedValue : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    throw new Error('Stored GitHub sign-in could not be read securely.')
  }
}

export async function writeStoredGitHubTokens(tokens: StoredGitHubTokens) {
  await ensureEncryptionAvailable()
  const { safeStorage } = await getElectronModule()
  const filePath = await getGitHubAuthFilePath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const encryptedValue = safeStorage.encryptString(JSON.stringify(tokens)).toString('base64')
  await writeJsonFileAtomic(filePath, `${encryptedValue}\n`)
}
