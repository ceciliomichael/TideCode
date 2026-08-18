import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { writeJsonFileAtomic } from '../settings/fileStore'
import { getRemoteStateRoot } from './statePath'

const scrypt = promisify(scryptCallback)
const REMOTE_AUTH_FILE_NAME = 'remote-auth.json'
const SCRYPT_KEY_LENGTH = 64

interface StoredRemoteCredential {
  algorithm: 'scrypt-v1'
  hash: string
  salt: string
}

function getRemoteAuthPath() {
  return path.join(getRemoteStateRoot(), REMOTE_AUTH_FILE_NAME)
}

function isStoredCredential(value: unknown): value is StoredRemoteCredential {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StoredRemoteCredential>
  return candidate.algorithm === 'scrypt-v1'
    && typeof candidate.hash === 'string'
    && candidate.hash.length > 0
    && typeof candidate.salt === 'string'
    && candidate.salt.length > 0
}

async function readCredential() {
  try {
    const raw = await fs.readFile(getRemoteAuthPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return isStoredCredential(parsed) ? parsed : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    console.error('Failed to read TideCode Remote credentials.', error)
    return null
  }
}

export async function hasRemoteCredential() {
  return (await readCredential()) !== null
}

export async function setRemotePassword(password: string) {
  if (password.length < 8) throw new Error('Remote password must be at least 8 characters.')
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, SCRYPT_KEY_LENGTH) as Buffer
  const credential: StoredRemoteCredential = {
    algorithm: 'scrypt-v1',
    hash: key.toString('base64'),
    salt: salt.toString('base64'),
  }
  await fs.mkdir(path.dirname(getRemoteAuthPath()), { recursive: true })
  await writeJsonFileAtomic(getRemoteAuthPath(), JSON.stringify(credential, null, 2) + '\n')
}

export async function verifyRemotePassword(password: string) {
  const credential = await readCredential()
  if (!credential) return false
  try {
    const salt = Buffer.from(credential.salt, 'base64')
    const expected = Buffer.from(credential.hash, 'base64')
    const actual = await scrypt(password, salt, expected.length) as Buffer
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

export async function clearRemotePassword() {
  try {
    await fs.unlink(getRemoteAuthPath())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
