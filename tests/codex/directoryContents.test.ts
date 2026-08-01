import assert from 'node:assert/strict'
import { promises as fs, watch } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { resetDirectoryContents } from '../../electron/history/directoryContents'

test('resetDirectoryContents clears entries without removing a watched root directory', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-directory-contents-'))
  const directoryPath = path.join(tempRootPath, 'VIRT_draft')
  const nestedDirectoryPath = path.join(directoryPath, 'nested')
  await fs.mkdir(nestedDirectoryPath, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(directoryPath, 'draft.txt'), 'draft', 'utf8'),
    fs.writeFile(path.join(nestedDirectoryPath, 'nested.txt'), 'nested', 'utf8'),
  ])
  const watcher = watch(directoryPath, { persistent: false }, () => undefined)

  try {
    await resetDirectoryContents(directoryPath)

    assert.equal((await fs.stat(directoryPath)).isDirectory(), true)
    assert.deepEqual(await fs.readdir(directoryPath), [])
  } finally {
    watcher.close()
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})

test('resetDirectoryContents is idempotent and creates a missing root directory', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-directory-contents-missing-'))
  const directoryPath = path.join(tempRootPath, 'VIRT_draft')

  try {
    await resetDirectoryContents(directoryPath)
    await resetDirectoryContents(directoryPath)

    assert.equal((await fs.stat(directoryPath)).isDirectory(), true)
    assert.deepEqual(await fs.readdir(directoryPath), [])
  } finally {
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})
