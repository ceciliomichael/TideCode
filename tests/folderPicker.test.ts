import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import {
  createFolderPickerDirectory,
  listFolderPickerDirectory,
  renameFolderPickerDirectory,
} from '../electron/folderPicker'

const execFileAsync = promisify(execFile)

test('folder picker lists directories only and returns navigation metadata', async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-folder-picker-'))
  try {
    await Promise.all([
      fs.mkdir(path.join(rootPath, 'Beta')),
      fs.mkdir(path.join(rootPath, 'alpha')),
      fs.writeFile(path.join(rootPath, 'notes.txt'), 'ignored'),
    ])

    const result = await listFolderPickerDirectory(rootPath)

    assert.equal(result.path, path.resolve(rootPath))
    assert.equal(result.parentPath, path.dirname(path.resolve(rootPath)))
    assert.deepEqual(result.entries.map((entry) => entry.name), ['alpha', 'Beta'])
    assert.equal(result.entries.every((entry) => path.isAbsolute(entry.path)), true)
    assert.equal(result.breadcrumbs.at(-1)?.path, path.resolve(rootPath))
  } finally {
    await fs.rm(rootPath, { force: true, recursive: true })
  }
})

test('folder picker creates a directory and returns its absolute path', async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-folder-picker-'))
  try {
    const created = await createFolderPickerDirectory(rootPath, 'New project')

    assert.equal(created.name, 'New project')
    assert.equal(created.path, path.join(path.resolve(rootPath), 'New project'))
    assert.equal((await fs.stat(created.path)).isDirectory(), true)
  } finally {
    await fs.rm(rootPath, { force: true, recursive: true })
  }
})

test('folder picker rejects traversal-style directory names', async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-folder-picker-'))
  try {
    await assert.rejects(
      () => createFolderPickerDirectory(rootPath, '..'),
      /Folder name is invalid/u,
    )
    await assert.rejects(
      () => createFolderPickerDirectory(rootPath, 'nested/folder'),
      /Folder name is invalid/u,
    )
  } finally {
    await fs.rm(rootPath, { force: true, recursive: true })
  }
})

test('folder picker renames a directory without leaving the parent directory', async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-folder-picker-'))
  try {
    const originalPath = path.join(rootPath, 'Before')
    await fs.mkdir(originalPath)

    const renamed = await renameFolderPickerDirectory(originalPath, 'After')

    assert.equal(renamed.name, 'After')
    assert.equal(renamed.path, path.join(rootPath, 'After'))
    assert.equal((await fs.stat(renamed.path)).isDirectory(), true)
    await assert.rejects(() => fs.stat(originalPath), { code: 'ENOENT' })
  } finally {
    await fs.rm(rootPath, { force: true, recursive: true })
  }
})

test(
  'folder picker hides Windows system folders but keeps user-hidden folders',
  { skip: process.platform !== 'win32' },
  async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-folder-picker-'))
    const userHiddenPath = path.join(rootPath, 'User hidden')
    const systemHiddenPath = path.join(rootPath, 'System hidden')
    try {
      await Promise.all([
        fs.mkdir(userHiddenPath),
        fs.mkdir(systemHiddenPath),
      ])
      await execFileAsync('attrib', ['+H', userHiddenPath])
      await execFileAsync('attrib', ['+H', '+S', systemHiddenPath])

      const result = await listFolderPickerDirectory(rootPath)
      const names = result.entries.map((entry) => entry.name)

      assert.equal(names.includes('User hidden'), true)
      assert.equal(names.includes('System hidden'), false)
    } finally {
      await execFileAsync('attrib', ['-H', userHiddenPath]).catch(() => undefined)
      await execFileAsync('attrib', ['-H', '-S', systemHiddenPath]).catch(() => undefined)
      await fs.rm(rootPath, { force: true, recursive: true })
    }
  },
)
