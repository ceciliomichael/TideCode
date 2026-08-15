import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const RUN_SERVICE_DIRECTORY = path.join(os.homedir(), '.tidecode', 'run-service')
const TOKEN_PATH = path.join(RUN_SERVICE_DIRECTORY, 'token')
const SOCKET_PATH = path.join(RUN_SERVICE_DIRECTORY, 'service.sock')

function getStableUserKey() {
  return createHash('sha256').update(os.homedir()).digest('hex').slice(0, 16)
}

export function getRunServiceEndpoint() {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\tidecode-run-service-${getStableUserKey()}`
  }
  return SOCKET_PATH
}

export async function ensureRunServiceDirectory() {
  await fs.mkdir(RUN_SERVICE_DIRECTORY, { recursive: true })
  if (process.platform !== 'win32') {
    await fs.chmod(RUN_SERVICE_DIRECTORY, 0o700).catch(() => undefined)
  }
}

async function readExistingToken() {
  const existing = (await fs.readFile(TOKEN_PATH, 'utf8')).trim()
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
  try {
    await fs.writeFile(TOKEN_PATH, `${token}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    if (process.platform !== 'win32') {
      await fs.chmod(TOKEN_PATH, 0o600).catch(() => undefined)
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
    await fs.unlink(SOCKET_PATH)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
