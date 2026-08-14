import { promises as fs } from 'node:fs'

const LOCK_RETRY_DELAY_MS = 50
const LOCK_ACQUIRE_TIMEOUT_MS = 30_000
const STALE_LOCK_AFTER_MS = 60_000

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'EEXIST'
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function waitForRetry() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, LOCK_RETRY_DELAY_MS)
  })
}

async function removeStaleLock(lockPath: string) {
  try {
    const stats = await fs.stat(lockPath)
    if (Date.now() - stats.mtimeMs < STALE_LOCK_AFTER_MS) return false
    await fs.unlink(lockPath)
    return true
  } catch (error) {
    if (isNotFoundError(error)) return true
    return false
  }
}

async function acquireLock(lockPath: string) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < LOCK_ACQUIRE_TIMEOUT_MS) {
    try {
      const handle = await fs.open(lockPath, 'wx')
      try {
        await handle.writeFile(JSON.stringify({ acquiredAt: Date.now(), pid: process.pid }), 'utf8')
        return handle
      } catch (error) {
        await handle.close().catch(() => undefined)
        await fs.unlink(lockPath).catch(() => undefined)
        throw error
      }
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error
      if (!await removeStaleLock(lockPath)) await waitForRetry()
    }
  }

  throw new Error(`Timed out acquiring the history lock: ${lockPath}`)
}

export async function withFileLock<T>(lockPath: string, action: () => Promise<T>) {
  const handle = await acquireLock(lockPath)
  try {
    return await action()
  } finally {
    await handle.close().catch(() => undefined)
    await fs.unlink(lockPath).catch((error: unknown) => {
      if (!isNotFoundError(error)) throw error
    })
  }
}
