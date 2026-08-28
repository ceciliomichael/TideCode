import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { withFileLock } from '../electron/chat/history/fileLock'

function transientError(code: string) {
  const error = new Error('simulated transient lock failure') as NodeJS.ErrnoException
  error.code = code
  return error
}

for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
  test('history lock release retries transient ' + code + ' failures', async (t) => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-history-lock-'))
    const lockPath = path.join(directory, 'history.lock')
    const realUnlink = fs.unlink.bind(fs)
    let attempts = 0

    t.mock.method(fs, 'unlink', async (candidatePath) => {
      if (String(candidatePath) === lockPath && attempts < 2) {
        attempts += 1
        throw transientError(code)
      }
      await realUnlink(candidatePath)
    })

    try {
      const result = await withFileLock(lockPath, async () => 'ok')
      assert.equal(result, 'ok')
      assert.equal(attempts, 2)
      await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' })
    } finally {
      await fs.rm(directory, { force: true, recursive: true })
    }
  })
}

test('history lock surfaces a persistent cleanup failure after bounded retries', async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-history-lock-'))
  const lockPath = path.join(directory, 'history.lock')

  t.mock.method(fs, 'unlink', async (candidatePath) => {
    if (String(candidatePath) === lockPath) throw transientError('EPERM')
    await fs.rm(candidatePath, { force: true })
  })

  try {
    await assert.rejects(
      withFileLock(lockPath, async () => undefined),
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'EPERM',
    )
  } finally {
    t.mock.restoreAll()
    await fs.rm(directory, { force: true, recursive: true })
  }
})
