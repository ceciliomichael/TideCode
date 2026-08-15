import test from 'node:test'
import assert from 'node:assert/strict'
import { renderTerminalComposerStatus } from '../../electron/cli/terminalComposerStatus'
import { shouldRefreshCodexUsage } from '../../electron/cli/cliComposerStatus'
import { stripAnsi, visibleWidth } from '../../electron/cli/terminalText'

test('composer status keeps runtime details left and usage metrics right', () => {
  const line = renderTerminalComposerStatus({
    mode: 'agent',
    model: 'gpt-5.6-luna',
    reasoningEffort: 'high',
    codexUsage: 'Week 82%',
    contextPercent: 14.25,
  }, 88)

  const plain = stripAnsi(line)
  assert.match(plain, /agent · gpt-5\.6-luna · high/)
  assert.match(plain, /Week 82% · Context 14\.3%/)
  assert.doesNotMatch(plain, /Codex Week/)
  assert.ok(visibleWidth(line) <= 88)
})

test('composer usage hydrates immediately when switching into Codex', () => {
  assert.equal(shouldRefreshCodexUsage('openai', 'codex'), true)
  assert.equal(shouldRefreshCodexUsage('custom:local', 'codex'), true)
  assert.equal(shouldRefreshCodexUsage('codex', 'codex'), false)
  assert.equal(shouldRefreshCodexUsage('codex', 'anthropic'), false)
})
