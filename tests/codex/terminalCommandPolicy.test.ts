import assert from 'node:assert/strict'
import test from 'node:test'
import { isAllowedTerminalCommand, parseTerminalCommandAllowlist } from '../../electron/chat/shared/tools/terminalCommandPolicy'

test('parseTerminalCommandAllowlist ignores blank lines and markdown comments', () => {
  const allowlist = parseTerminalCommandAllowlist(`
# Terminal command allowlist

pwd

# Inspection commands
git diff
npm test
`)

  assert.deepEqual(allowlist, ['pwd', 'git diff', 'npm test'])
})

test('isAllowedTerminalCommand matches prefixes and rejects unsafe shell operators', () => {
  const allowlist = ['git diff', 'npm run test', 'Get-Content']

  assert.equal(isAllowedTerminalCommand('git diff --stat', allowlist), true)
  assert.equal(isAllowedTerminalCommand('npm run test:unit', allowlist), true)
  assert.equal(isAllowedTerminalCommand('Get-Content src/file.txt', allowlist), true)
  assert.equal(isAllowedTerminalCommand('git diff > out.txt', allowlist), false)
  assert.equal(isAllowedTerminalCommand('npm run test && echo done', allowlist), false)
  assert.equal(isAllowedTerminalCommand('echo hello', allowlist), false)
})

test('isAllowedTerminalCommand allows any non-empty command in full access mode', () => {
  const allowlist = ['git diff']

  assert.equal(isAllowedTerminalCommand('echo hello && whoami', 'full', allowlist), true)
  assert.equal(isAllowedTerminalCommand('Get-Content src/file.txt | Select-Object -First 1', 'full', allowlist), true)
  assert.equal(isAllowedTerminalCommand('   ', 'full', allowlist), false)
})
