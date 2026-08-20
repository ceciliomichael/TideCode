import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { writeJsonFileAtomic } from '../settings/fileStore'

export const REMOTE_SESSION_COOKIE_NAME = 'tidecode_remote_session'
export const REMOTE_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

interface SessionRecord {
  expiresAt: number
  originHost: string | null
}

interface PersistedSessionRecord extends SessionRecord {
  sessionHash: string
}

interface RemoteWebSessionStoreOptions {
  persistencePath?: string
}

function hashSessionId(sessionId: string) {
  return createHash('sha256').update(sessionId).digest('base64url')
}

function parseCookies(header: string | undefined) {
  const result = new Map<string, string>()
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (key) result.set(key, value)
  }
  return result
}

function getOriginHost(request: IncomingMessage) {
  const origin = request.headers.origin
  if (!origin) return null
  try {
    return new URL(origin).host.toLowerCase()
  } catch {
    return null
  }
}

function isPersistedSessionRecord(value: unknown): value is PersistedSessionRecord {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PersistedSessionRecord>
  return typeof candidate.sessionHash === 'string'
    && /^[A-Za-z0-9_-]{43}$/u.test(candidate.sessionHash)
    && typeof candidate.expiresAt === 'number'
    && Number.isFinite(candidate.expiresAt)
    && (typeof candidate.originHost === 'string' || candidate.originHost === null)
}

export function getRemoteSessionId(request: IncomingMessage) {
  return parseCookies(request.headers.cookie).get(REMOTE_SESSION_COOKIE_NAME) ?? null
}

export class RemoteWebSessionStore {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly persistencePath: string | null
  private persistenceQueue: Promise<void> = Promise.resolve()

  constructor(options: RemoteWebSessionStoreOptions = {}) {
    this.persistencePath = options.persistencePath ? path.resolve(options.persistencePath) : null
  }

  async load() {
    if (!this.persistencePath) return
    await this.persistenceQueue.catch(() => undefined)
    let parsed: unknown
    try {
      parsed = JSON.parse(await fs.readFile(this.persistencePath, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Failed to read TideCode Remote sessions.', error)
      }
      return
    }

    const records = Array.isArray(parsed) ? parsed.filter(isPersistedSessionRecord) : []
    const now = Date.now()
    this.sessions.clear()
    for (const record of records) {
      if (record.expiresAt > now) {
        this.sessions.set(record.sessionHash, {
          expiresAt: record.expiresAt,
          originHost: record.originHost,
        })
      }
    }
    if (records.length !== this.sessions.size) this.schedulePersist()
  }

  create(request: IncomingMessage, response: ServerResponse, rememberMe = true) {
    const sessionId = randomUUID()
    const expiresAt = Date.now() + REMOTE_SESSION_TTL_MS
    this.sessions.set(hashSessionId(sessionId), {
      expiresAt,
      originHost: getOriginHost(request),
    })
    const persistenceAttributes = rememberMe
      ? '; Max-Age=' + Math.floor(REMOTE_SESSION_TTL_MS / 1000) + '; Expires=' + new Date(expiresAt).toUTCString()
      : ''
    response.setHeader(
      'Set-Cookie',
      REMOTE_SESSION_COOKIE_NAME + '=' + sessionId + '; HttpOnly; SameSite=Lax; Path=/' + persistenceAttributes,
    )
    if (rememberMe) this.schedulePersist()
    return sessionId
  }

  clear(persist = true) {
    this.sessions.clear()
    if (persist) this.schedulePersist()
  }

  delete(request: IncomingMessage, response?: ServerResponse) {
    const sessionId = getRemoteSessionId(request)
    if (sessionId) this.sessions.delete(hashSessionId(sessionId))
    if (response) {
      response.setHeader(
        'Set-Cookie',
        REMOTE_SESSION_COOKIE_NAME + '=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      )
    }
    this.schedulePersist()
  }

  validate(request: IncomingMessage) {
    const sessionId = getRemoteSessionId(request)
    if (!sessionId) return null
    const record = this.sessions.get(hashSessionId(sessionId))
    if (!record) return null
    if (record.expiresAt <= Date.now()) {
      this.sessions.delete(hashSessionId(sessionId))
      this.schedulePersist()
      return null
    }
    return sessionId
  }

  getRemainingMs(sessionId: string) {
    const record = this.sessions.get(hashSessionId(sessionId))
    return record ? Math.max(0, record.expiresAt - Date.now()) : 0
  }

  matchesOrigin(sessionId: string, request: IncomingMessage) {
    const record = this.sessions.get(hashSessionId(sessionId))
    const originHost = getOriginHost(request)
    return Boolean(record?.originHost && originHost && record.originHost === originHost)
  }

  async flush() {
    await this.persistenceQueue
  }

  private schedulePersist() {
    if (!this.persistencePath) return
    const records: PersistedSessionRecord[] = [...this.sessions].map(([sessionHash, record]) => ({
      expiresAt: record.expiresAt,
      originHost: record.originHost,
      sessionHash,
    }))
    this.persistenceQueue = this.persistenceQueue
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(path.dirname(this.persistencePath as string), { recursive: true })
        await writeJsonFileAtomic(this.persistencePath as string, JSON.stringify(records, null, 2) + '\n')
      })
      .catch((error: unknown) => {
        console.error('Failed to persist TideCode Remote sessions.', error)
      })
  }
}
