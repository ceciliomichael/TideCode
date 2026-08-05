import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { mock } from 'node:test'
import { writeConversationFileAtomic } from '../../electron/history/conversationFileWriter'

test('conversation file replacement retries a transient Windows lock', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-conversation-atomic-'))
  const targetPath = path.join(tempRootPath, 'conversation.json')
  const backupPath = `${targetPath}.bak`
  const originalRename = fs.rename.bind(fs)
  let initialInstallAttempt = true
  let backupRenameAttempts = 0

  try {
    await fs.writeFile(targetPath, 'original', 'utf8')

    mock.method(fs, 'rename', async (source, destination) => {
      const normalizedSource = String(source)
      const normalizedDestination = String(destination)
      if (initialInstallAttempt && normalizedDestination === targetPath) {
        initialInstallAttempt = false
        const error = new Error('File exists') as NodeJS.ErrnoException
        error.code = 'EEXIST'
        throw error
      }
      if (normalizedDestination === backupPath && backupRenameAttempts === 0) {
        backupRenameAttempts += 1
        const error = new Error('File is busy') as NodeJS.ErrnoException
        error.code = 'EBUSY'
        throw error
      }
      return originalRename(normalizedSource, normalizedDestination)
    })

    await writeConversationFileAtomic(targetPath, 'updated')

    assert.equal(await fs.readFile(targetPath, 'utf8'), 'updated')
    await assert.rejects(fs.access(backupPath), { code: 'ENOENT' })
    const remainingFiles = await fs.readdir(tempRootPath)
    assert.deepEqual(remainingFiles, ['conversation.json'])
  } finally {
    mock.restoreAll()
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})
