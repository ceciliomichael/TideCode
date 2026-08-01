import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  assertSandboxPathDoesNotEscapeThroughSymlink,
  type SandboxPathRoots,
} from '../../electron/chat/shared/tools/sandboxPaths'

test('sandbox canonical path checks reject a symlink that escapes an allowed root', async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-sandbox-symlink-'))
  const workspaceRootPath = path.join(fixtureRoot, 'workspace')
  const globalAgentsDirectory = path.join(fixtureRoot, '.agents')
  const outsideDirectory = path.join(fixtureRoot, 'outside')
  const linkedDirectory = path.join(globalAgentsDirectory, 'skills', 'escaping-skill')
  const roots: SandboxPathRoots = {
    globalAgentsDirectory,
    workspaceRootPath,
  }

  try {
    await Promise.all([
      fs.mkdir(workspaceRootPath, { recursive: true }),
      fs.mkdir(path.dirname(linkedDirectory), { recursive: true }),
      fs.mkdir(outsideDirectory, { recursive: true }),
    ])
    await fs.writeFile(path.join(outsideDirectory, 'secret.txt'), 'outside\n', 'utf8')
    await fs.symlink(
      outsideDirectory,
      linkedDirectory,
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    await assert.rejects(
      assertSandboxPathDoesNotEscapeThroughSymlink(
        path.join(linkedDirectory, 'secret.txt'),
        roots,
      ),
      /escapes the sandbox roots through a symbolic link/u,
    )
  } finally {
    await fs.rm(fixtureRoot, { force: true, recursive: true })
  }
})

test('sandbox canonical path checks allow ordinary files inside an allowed root', async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-sandbox-inside-'))
  const workspaceRootPath = path.join(fixtureRoot, 'workspace')
  const globalAgentsDirectory = path.join(fixtureRoot, '.agents')
  const resourcePath = path.join(globalAgentsDirectory, 'skills', 'safe-skill', 'reference.md')
  const roots: SandboxPathRoots = {
    globalAgentsDirectory,
    workspaceRootPath,
  }

  try {
    await fs.mkdir(path.dirname(resourcePath), { recursive: true })
    await fs.writeFile(resourcePath, 'safe\n', 'utf8')

    await assert.doesNotReject(
      assertSandboxPathDoesNotEscapeThroughSymlink(resourcePath, roots),
    )
  } finally {
    await fs.rm(fixtureRoot, { force: true, recursive: true })
  }
})
