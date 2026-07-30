import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldAlwaysShowEntry, shouldIgnoreWorkspaceEntry } from '../../electron/workspace/gitignoreMatcher'

test('shouldIgnoreWorkspaceEntry ignores .echosphere by default in workspace mode', () => {
  assert.equal(shouldIgnoreWorkspaceEntry('.echosphere'), true)
  assert.equal(shouldIgnoreWorkspaceEntry('.echosphere', 'workspace'), true)
  assert.equal(shouldIgnoreWorkspaceEntry('.echosphere', 'explorer'), false)
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
