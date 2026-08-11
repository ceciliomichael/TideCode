import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { writeClipboardImageToWorkspace } from '../electron/workspace/clipboardImage'

test('clipboard images use collision-safe PNG filenames in the selected directory', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-clipboard-image-'))
  const targetDirectoryPath = path.join(workspaceRootPath, 'assets')
  const pngData = Buffer.from('png-data')
  await fs.mkdir(targetDirectoryPath)
  await fs.writeFile(path.join(targetDirectoryPath, 'pasted-image.png'), Buffer.from('existing'))

  try {
    const result = await writeClipboardImageToWorkspace({
      targetDirectoryRelativePath: 'assets',
      workspaceRootPath,
    }, pngData)

    assert.equal(result.relativePath, path.join('assets', 'pasted-image-2.png'))
    assert.equal(result.sizeBytes, pngData.length)
    assert.deepEqual(await fs.readFile(path.join(targetDirectoryPath, 'pasted-image-2.png')), pngData)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('clipboard image paste rejects a file target instead of writing beside it', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-clipboard-image-target-'))
  await fs.writeFile(path.join(workspaceRootPath, 'target.txt'), 'content')

  try {
    await assert.rejects(
      writeClipboardImageToWorkspace({
        targetDirectoryRelativePath: 'target.txt',
        workspaceRootPath,
      }, Buffer.from('png-data')),
      /Expected a directory/u,
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
