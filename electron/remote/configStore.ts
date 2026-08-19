import { promises as fs } from 'node:fs'
import path from 'node:path'
import { writeJsonFileAtomic } from '../settings/fileStore'
import { getRemoteStateRoot } from './statePath'

export const DEFAULT_REMOTE_PORT = 38472
export const MIN_REMOTE_PORT = 1024
export const MAX_REMOTE_PORT = 65_535

export interface RemoteHostConfiguration {
  port: number
  webAuthEnabled: boolean
  webUsername: string
}

const DEFAULT_REMOTE_CONFIGURATION: RemoteHostConfiguration = {
  port: DEFAULT_REMOTE_PORT,
  webAuthEnabled: false,
  webUsername: '',
}

const REMOTE_CONFIG_FILE_NAME = 'remote-config.json'
let configQueue: Promise<void> = Promise.resolve()
let cachedConfiguration: RemoteHostConfiguration | null = null

function getRemoteConfigPath() {
  return path.join(getRemoteStateRoot(), REMOTE_CONFIG_FILE_NAME)
}

export function normalizeRemotePort(value: unknown) {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= MIN_REMOTE_PORT
    && value <= MAX_REMOTE_PORT
    ? value
    : DEFAULT_REMOTE_PORT
}

export function normalizeRemoteConfiguration(input: Partial<RemoteHostConfiguration> | null | undefined): RemoteHostConfiguration {
  return {
    port: normalizeRemotePort(input?.port),
    webAuthEnabled: typeof input?.webAuthEnabled === 'boolean' ? input.webAuthEnabled : false,
    webUsername: typeof input?.webUsername === 'string' ? input.webUsername.trim().slice(0, 128) : '',
  }
}

export async function readRemoteConfiguration() {
  if (cachedConfiguration) return { ...cachedConfiguration }
  try {
    const raw = await fs.readFile(getRemoteConfigPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<RemoteHostConfiguration>
    cachedConfiguration = normalizeRemoteConfiguration(parsed)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Failed to read TideCode Remote configuration.', error)
    }
    cachedConfiguration = { ...DEFAULT_REMOTE_CONFIGURATION }
  }
  return { ...cachedConfiguration }
}

export async function writeRemoteConfiguration(input: RemoteHostConfiguration) {
  const normalized = normalizeRemoteConfiguration(input)
  configQueue = configQueue.catch(() => undefined).then(async () => {
    await fs.mkdir(path.dirname(getRemoteConfigPath()), { recursive: true })
    await writeJsonFileAtomic(getRemoteConfigPath(), JSON.stringify(normalized, null, 2) + '\n')
    cachedConfiguration = normalized
  })
  await configQueue
  return { ...normalized }
}

export async function updateRemoteConfiguration(input: Partial<RemoteHostConfiguration>) {
  const current = await readRemoteConfiguration()
  return writeRemoteConfiguration({ ...current, ...input })
}
