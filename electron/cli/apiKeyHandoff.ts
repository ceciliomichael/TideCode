import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promises as fs, type Dirent } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { electronApp } from '../electronApp'

const execFileAsync = promisify(execFile)
const HANDOFF_DIRECTORY_SEGMENTS = ['.tidecode', 'config', 'cli-api-key-handoffs'] as const
const HANDOFF_FILE_SUFFIX = '.json'
const API_KEY_HANDOFF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u
const HANDOFF_FILE_NAME_PATTERN = /^([A-Za-z0-9_-]{32,128})\.json$/u
const CONSUMING_HANDOFF_FILE_NAME_PATTERN = /^([A-Za-z0-9_-]{32,128})\.json\.consuming-\d+-[a-f0-9]+$/u
export const API_KEY_HANDOFF_TTL_MS = 30_000
export const API_KEY_HANDOFF_STALE_FILE_MS = API_KEY_HANDOFF_TTL_MS * 2

interface ApiKeyHandoffRecord {
  apiKey: string
  expiresAt: number
}

export interface ApiKeyHandoffOptions {
  homeDirectory?: string
  now?: () => number
  platform?: NodeJS.Platform
}

function getHandoffDirectoryPath(homeDirectory = electronApp.getPath('home')) {
  return path.join(homeDirectory, ...HANDOFF_DIRECTORY_SEGMENTS)
}

function isValidToken(token: string): boolean {
  return API_KEY_HANDOFF_TOKEN_PATTERN.test(token)
}

function getHandoffFilePath(token: string, homeDirectory?: string): string | null {
  if (!isValidToken(token)) return null
  return path.join(getHandoffDirectoryPath(homeDirectory), `${token}${HANDOFF_FILE_SUFFIX}`)
}

function getWindowsAccountName(): string {
  const username = os.userInfo().username.trim()
  const domain = process.env.USERDOMAIN?.trim()
  if (!username) throw new Error('Unable to resolve the current Windows account.')
  return domain ? `${domain}\\${username}` : username
}

async function applyOwnerOnlyPermissions(targetPath: string, options: Required<Pick<ApiKeyHandoffOptions, 'platform'>>): Promise<void> {
  await fs.chmod(targetPath, 0o600)
  if (options.platform !== 'win32') return

  await execFileAsync(
    'icacls',
    [targetPath, '/inheritance:r', '/grant:r', `${getWindowsAccountName()}:F`],
    { windowsHide: true },
  )
}

async function ensureHandoffDirectory(options: Required<Pick<ApiKeyHandoffOptions, 'homeDirectory' | 'platform'>>): Promise<string> {
  const directoryPath = getHandoffDirectoryPath(options.homeDirectory)
  await fs.mkdir(directoryPath, { recursive: true, mode: 0o700 })
  if (options.platform === 'win32') {
    await execFileAsync(
      'icacls',
      [directoryPath, '/inheritance:r', '/grant:r', `${getWindowsAccountName()}:(OI)(CI)F`],
      { windowsHide: true },
    )
  } else {
    await fs.chmod(directoryPath, 0o700)
  }
  return directoryPath
}

async function unlinkIfPresent(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function isOlderThan(filePath: string, cutoffMs: number): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath)
    return stats.isFile() && stats.mtimeMs < cutoffMs
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function cleanupExpiredApiKeyHandoffs(options: ApiKeyHandoffOptions = {}): Promise<void> {
  const directoryPath = getHandoffDirectoryPath(options.homeDirectory)
  const now = options.now ?? Date.now
  const nowMs = now()
  const staleCutoffMs = nowMs - API_KEY_HANDOFF_STALE_FILE_MS

  let entries: Dirent<string>[]
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile()) return
    const filePath = path.join(directoryPath, entry.name)

    if (CONSUMING_HANDOFF_FILE_NAME_PATTERN.test(entry.name)) {
      if (await isOlderThan(filePath, staleCutoffMs)) {
        await unlinkIfPresent(filePath)
      }
      return
    }

    if (!HANDOFF_FILE_NAME_PATTERN.test(entry.name)) return

    let shouldDelete = false
    try {
      const rawRecord = await fs.readFile(filePath, 'utf8')
      const parsedRecord = JSON.parse(rawRecord) as Partial<ApiKeyHandoffRecord>
      if (typeof parsedRecord.expiresAt === 'number' && Number.isFinite(parsedRecord.expiresAt)) {
        shouldDelete = parsedRecord.expiresAt <= nowMs
      } else {
        shouldDelete = await isOlderThan(filePath, staleCutoffMs)
      }
    } catch {
      shouldDelete = await isOlderThan(filePath, staleCutoffMs).catch(() => false)
    }

    if (shouldDelete) {
      await unlinkIfPresent(filePath)
    }
  }))
}

export async function createApiKeyHandoff(apiKey: string, options: ApiKeyHandoffOptions = {}): Promise<string> {
  if (!apiKey.trim()) throw new Error('Cannot create an empty API-key handoff.')

  const resolvedOptions = {
    homeDirectory: options.homeDirectory ?? electronApp.getPath('home'),
    now: options.now ?? Date.now,
    platform: options.platform ?? process.platform,
  }
  await cleanupExpiredApiKeyHandoffs(resolvedOptions).catch(() => undefined)
  const directoryPath = await ensureHandoffDirectory(resolvedOptions)
  const token = randomBytes(32).toString('base64url')
  const filePath = path.join(directoryPath, `${token}${HANDOFF_FILE_SUFFIX}`)
  const record: ApiKeyHandoffRecord = {
    apiKey,
    expiresAt: resolvedOptions.now() + API_KEY_HANDOFF_TTL_MS,
  }

  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    handle = await fs.open(filePath, 'wx', 0o600)
    await handle.writeFile(JSON.stringify(record), 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await applyOwnerOnlyPermissions(filePath, resolvedOptions)
    return token
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined)
    await unlinkIfPresent(filePath).catch(() => undefined)
    throw error
  }
}

export async function consumeApiKeyHandoff(token: string, options: ApiKeyHandoffOptions = {}): Promise<string | null> {
  const filePath = getHandoffFilePath(token, options.homeDirectory)
  if (!filePath) return null

  const now = options.now ?? Date.now
  const claimedPath = `${filePath}.consuming-${process.pid}-${randomBytes(12).toString('hex')}`
  try {
    await fs.rename(filePath, claimedPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  try {
    const rawRecord = await fs.readFile(claimedPath, 'utf8')
    const parsedRecord = JSON.parse(rawRecord) as Partial<ApiKeyHandoffRecord>
    if (typeof parsedRecord.apiKey !== 'string' || !parsedRecord.apiKey.trim()) return null
    if (typeof parsedRecord.expiresAt !== 'number' || parsedRecord.expiresAt < now()) return null
    return parsedRecord.apiKey
  } catch {
    return null
  } finally {
    await unlinkIfPresent(claimedPath).catch(() => undefined)
  }
}

export async function discardApiKeyHandoff(token: string, homeDirectory?: string): Promise<void> {
  const filePath = getHandoffFilePath(token, homeDirectory)
  if (filePath) await unlinkIfPresent(filePath)
}
