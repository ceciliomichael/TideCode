import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readWorkspaceFile } from '../../electron/workspace/explorer'

async function createWorkspaceFixture() {
  return fs.mkdtemp(path.join(tmpdir(), 'tidecode-workspace-read-'))
}

test('readWorkspaceFile returns a controlled missing result for a deleted file', async () => {
  const workspaceRootPath = await createWorkspaceFixture()

  try {
    const result = await readWorkspaceFile({
      relativePath: 'README.md',
      workspaceRootPath,
    })

    assert.deepEqual(result, {
      relativePath: 'README.md',
      status: 'missing',
    })
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('readWorkspaceFile returns ready content for an existing text file', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const relativePath = 'src/example.ts'
  const content = 'export const example = true\n'

  try {
    await fs.mkdir(path.join(workspaceRootPath, 'src'), { recursive: true })
    await fs.writeFile(path.join(workspaceRootPath, relativePath), content, 'utf8')

    const result = await readWorkspaceFile({
      relativePath,
      workspaceRootPath,
    })

    assert.equal(result.status, 'ready')
    if (result.status !== 'ready') {
      throw new Error('Expected an existing file to return a ready result.')
    }
    assert.equal(result.content, content)
    assert.equal(result.relativePath, path.normalize(relativePath))
    assert.equal(result.isBinary, false)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
