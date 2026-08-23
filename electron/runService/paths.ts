import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RUN_SERVICE_PROTOCOL_VERSION } from './protocol'
import { resolveRunServiceNamespace } from './namespace'

export interface RunServicePathOptions {
  environment?: NodeJS.ProcessEnv
  homeDirectory?: string
  platform?: NodeJS.Platform
}

function resolvePathContext(options: RunServicePathOptions = {}) {
  const environment = options.environment ?? process.env
  const homeDirectory = options.homeDirectory ?? os.homedir()
  const platform = options.platform ?? process.platform
  const namespace = resolveRunServiceNamespace(environment)
  const baseDirectory = path.join(homeDirectory, '.tidecode', 'run-service')
  const directory = namespace ? path.join(baseDirectory, namespace) : baseDirectory
  return { directory, homeDirectory, namespace, platform }
}

export function getRunServiceDirectory(options: RunServicePathOptions = {}) {
  return resolvePathContext(options).directory
}

function getStableUserKey(homeDirectory: string) {
  return createHash('sha256').update(homeDirectory).digest('hex').slice(0, 16)
}

export function getRunServiceEndpoint(options: RunServicePathOptions = {}) {
  const context = resolvePathContext(options)
  if (context.platform === 'win32') {
    const namespaceSuffix = context.namespace ? `-${context.namespace}` : ''
    return `\\\\.\\pipe\\tidecode-run-service-v${RUN_SERVICE_PROTOCOL_VERSION}-${getStableUserKey(context.homeDirectory)}${namespaceSuffix}`
  }
  return path.join(context.directory, `service-v${RUN_SERVICE_PROTOCOL_VERSION}.sock`)
}

export async function ensureRunServiceDirectory() {
  const directory = getRunServiceDirectory()
  await fs.mkdir(directory, { recursive: true })
  if (process.platform !== 'win32') {
    await fs.chmod(directory, 0o700).catch(() => undefined)
  }
}

async function readExistingToken() {
  const existing = (await fs.readFile(path.join(getRunServiceDirectory(), 'token'), 'utf8')).trim()
  if (!existing) throw new Error('The Tidecode run-service token file is empty.')
  return existing
}

export async function ensureRunServiceToken() {
  await ensureRunServiceDirectory()
  try {
    return await readExistingToken()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const token = randomBytes(32).toString('hex')
  const tokenPath = path.join(getRunServiceDirectory(), 'token')
  try {
    await fs.writeFile(tokenPath, `${token}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    if (process.platform !== 'win32') {
      await fs.chmod(tokenPath, 0o600).catch(() => undefined)
    }
    return token
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return readExistingToken()
  }
}

export async function removeStaleRunServiceSocket() {
  if (process.platform === 'win32') return
  try {
    await fs.unlink(getRunServiceEndpoint())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
