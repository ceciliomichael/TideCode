import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  isAgentInstructionsFile,
  isExplicitlyGitignoredPath,
  isGitignored,
  loadGitignoreMatchers,
  shouldAlwaysShowEntry,
  shouldIgnoreWorkspaceEntry,
} from '../../electron/workspace/gitignoreMatcher'

test('shouldIgnoreWorkspaceEntry ignores .tidecode by default in workspace mode', () => {
  assert.equal(shouldIgnoreWorkspaceEntry('.tidecode'), true)
  assert.equal(shouldIgnoreWorkspaceEntry('.tidecode', 'workspace'), true)
  assert.equal(shouldIgnoreWorkspaceEntry('.tidecode', 'explorer'), false)
})

test('shouldIgnoreWorkspaceEntry does not ignore AGENTS.md in workspace mode', () => {
  assert.equal(shouldIgnoreWorkspaceEntry('AGENTS.md'), false)
  assert.equal(shouldIgnoreWorkspaceEntry('AGENTS.md', 'workspace'), false)
  assert.equal(shouldIgnoreWorkspaceEntry('AGENTS.md', 'explorer'), false)
})

test('shouldAlwaysShowEntry matches .env* and AGENTS.md case-insensitively', () => {
  assert.equal(shouldAlwaysShowEntry('.env'), true)
  assert.equal(shouldAlwaysShowEntry('.env.local'), true)
  assert.equal(shouldAlwaysShowEntry('.env.example'), true)
  assert.equal(shouldAlwaysShowEntry('AGENTS.md'), true)
  assert.equal(shouldAlwaysShowEntry('agents.md'), true)
  assert.equal(shouldAlwaysShowEntry('AGENTS.md.bak'), true)
  assert.equal(shouldAlwaysShowEntry('main.ts'), false)
  assert.equal(shouldAlwaysShowEntry('node_modules'), false)
})

test('shouldIgnoreWorkspaceEntry hides generated files and common developer directories in workspace mode', () => {
  assert.equal(shouldIgnoreWorkspaceEntry('node_modules'), true)
  assert.equal(shouldIgnoreWorkspaceEntry('__pycache__'), true)
  assert.equal(shouldIgnoreWorkspaceEntry('bundle.js.map'), true)
  assert.equal(shouldIgnoreWorkspaceEntry('module.pyc'), true)
  assert.equal(shouldIgnoreWorkspaceEntry('vendor', 'explorer'), false)
})

test('isAgentInstructionsFile identifies only AGENTS.md case-insensitively', () => {
  assert.equal(isAgentInstructionsFile('AGENTS.md'), true)
  assert.equal(isAgentInstructionsFile('agents.md'), true)
  assert.equal(isAgentInstructionsFile('AGENTS.md.bak'), false)
  assert.equal(isAgentInstructionsFile('agents.txt'), false)
})

test('gitignore matching never hides AGENTS.md or CLAUDE.md', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-gitignore-instructions-'))
  const agentsPath = path.join(workspaceRootPath, 'AGENTS.md')
  const claudePath = path.join(workspaceRootPath, 'CLAUDE.md')
  const ignoredPath = path.join(workspaceRootPath, 'private.secret')

  try {
    await fs.writeFile(path.join(workspaceRootPath, '.gitignore'), 'AGENTS.md\nCLAUDE.md\n*.secret\n', 'utf8')
    await fs.writeFile(agentsPath, '# instructions\n', 'utf8')
    await fs.writeFile(claudePath, '# claude instructions\n', 'utf8')
    await fs.writeFile(ignoredPath, 'secret\n', 'utf8')

    const matcherEntries = await loadGitignoreMatchers(workspaceRootPath, workspaceRootPath)

    assert.equal(isGitignored(agentsPath, false, matcherEntries), false)
    assert.equal(await isExplicitlyGitignoredPath(workspaceRootPath, agentsPath, false), false)
    assert.equal(isGitignored(claudePath, false, matcherEntries), false)
    assert.equal(await isExplicitlyGitignoredPath(workspaceRootPath, claudePath, false), false)
    assert.equal(isGitignored(ignoredPath, false, matcherEntries), true)
    assert.equal(await isExplicitlyGitignoredPath(workspaceRootPath, ignoredPath, false), true)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
