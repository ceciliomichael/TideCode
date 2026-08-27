import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { listWorkspaceDirectory } from '../../electron/workspace/explorer'

async function createWorkspaceFixture() {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-workspace-explorer-'))

  await fs.mkdir(path.join(workspaceRootPath, '.git'), { recursive: true })
  await fs.mkdir(path.join(workspaceRootPath, '.next'), { recursive: true })
  await fs.mkdir(path.join(workspaceRootPath, 'ignored'), { recursive: true })
  await fs.mkdir(path.join(workspaceRootPath, 'node_modules', 'pkg'), { recursive: true })
  await fs.mkdir(path.join(workspaceRootPath, 'node_modules.echodeleting_1234567890', 'pkg'), { recursive: true })
  await fs.mkdir(path.join(workspaceRootPath, 'src'), { recursive: true })
  await fs.writeFile(path.join(workspaceRootPath, '.gitignore'), 'ignored/\nAGENTS.md\nCLAUDE.md\n', 'utf8')
  await fs.writeFile(path.join(workspaceRootPath, '.env'), 'SECRET=1\n', 'utf8')
  await fs.writeFile(path.join(workspaceRootPath, 'AGENTS.md'), '# repository instructions\n', 'utf8')
  await fs.writeFile(path.join(workspaceRootPath, 'CLAUDE.md'), '# claude instructions\n', 'utf8')
  await fs.writeFile(path.join(workspaceRootPath, 'ignored', 'hidden.ts'), 'export const hidden = true\n', 'utf8')
  await fs.writeFile(path.join(workspaceRootPath, 'node_modules', 'pkg', 'index.ts'), 'export const dep = true\n', 'utf8')
  await fs.writeFile(
    path.join(workspaceRootPath, 'node_modules.echodeleting_1234567890', 'pkg', 'index.ts'),
    'export const deleting = true\n',
    'utf8',
  )
  await fs.writeFile(path.join(workspaceRootPath, 'src', 'visible.ts'), 'export const visible = true\n', 'utf8')

  return workspaceRootPath
}

test('workspace directory listings can expose dependency folders in explorer mode while still hiding .git', async () => {
  const workspaceRootPath = await createWorkspaceFixture()

  try {
    const explorerEntries = await listWorkspaceDirectory({
      relativePath: '.',
      visibility: 'explorer',
      workspaceRootPath,
    })
    const explorerEntryNames = explorerEntries.map((entry) => entry.name)
    const explorerEntryByName = new Map(explorerEntries.map((entry) => [entry.name, entry]))

    assert.ok(explorerEntryNames.includes('node_modules'))
    assert.ok(explorerEntryNames.includes('.next'))
    assert.ok(explorerEntryNames.includes('ignored'))
    assert.ok(explorerEntryNames.includes('AGENTS.md'))
    assert.ok(explorerEntryNames.includes('CLAUDE.md'))
    assert.ok(!explorerEntryNames.includes('.git'))
    assert.ok(!explorerEntryNames.includes('node_modules.echodeleting_1234567890'))
    assert.equal(explorerEntryByName.get('ignored')?.isGitignored, true)
    assert.equal(explorerEntryByName.get('AGENTS.md')?.isGitignored, false)
    assert.equal(explorerEntryByName.get('CLAUDE.md')?.isGitignored, false)
    assert.equal(explorerEntryByName.get('node_modules')?.isGitignored, false)
    assert.equal(explorerEntryByName.get('.next')?.isGitignored, false)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('recursive workspace directory listings support mention/search consumers without exposing pruned paths', async () => {
  const workspaceRootPath = await createWorkspaceFixture()

  try {
    const workspaceEntries = await listWorkspaceDirectory({
      recursive: true,
      relativePath: '.',
      workspaceRootPath,
    })
    const workspaceEntryNames = workspaceEntries.map((entry) => entry.name)
    const workspaceRelativePaths = workspaceEntries.map((entry) => entry.relativePath.replace(/\\/g, '/'))

    assert.ok(workspaceEntryNames.includes('src'))
    assert.ok(workspaceEntryNames.includes('.env'))
    assert.ok(workspaceEntryNames.includes('AGENTS.md'))
    assert.ok(workspaceEntryNames.includes('CLAUDE.md'))
    assert.ok(workspaceRelativePaths.includes('src/visible.ts'))
    assert.ok(!workspaceEntryNames.includes('node_modules'))
    assert.ok(!workspaceEntryNames.includes('node_modules.echodeleting_1234567890'))
    assert.ok(!workspaceEntryNames.includes('.next'))
    assert.ok(!workspaceEntryNames.includes('.git'))
    assert.ok(!workspaceRelativePaths.includes('ignored/hidden.ts'))
    assert.equal(workspaceEntries.some((entry) => entry.isGitignored), false)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
