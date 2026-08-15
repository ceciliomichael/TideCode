import test from 'node:test'
import assert from 'node:assert/strict'
import { getTerminalPanelWidth, renderPromptPanel, renderSessionPanel } from '../../electron/cli/terminalPanels'
import { stripAnsi, visibleWidth } from '../../electron/cli/terminalText'

test('session panel keeps workspace context structured and bounded', () => {
  const lines = renderSessionPanel({
    workspace: 'C:/Users/Admin/Desktop/tidecode',
    model: 'gpt-5.6-luna xhigh',
    provider: 'codex',
    mode: 'agent',
    permissions: 'full access',
  })

  assert.equal(lines.length, 5)
  const widths = lines.map((line) => visibleWidth(line))
  assert.ok(widths.every((width) => width === widths[0]))
  assert.ok(lines.some((line) => stripAnsi(line).includes('workspace')))
  assert.ok(lines.some((line) => stripAnsi(line).includes('full access')))
  assert.ok(widths[0] < getTerminalPanelWidth())
})

test('session panel hides internal custom provider identifiers', () => {
  const rendered = renderSessionPanel({
    workspace: 'C:/workspace',
    model: 'gemma-4-12B-qat',
    provider: 'custom:a17cb6-internal-id',
    mode: 'agent',
    permissions: 'full access',
  }).map(stripAnsi).join('\n')

  assert.match(rendered, /gemma-4-12B-qat \[custom\]/u)
  assert.doesNotMatch(rendered, /a17cb6|custom:/u)
})

test('prompt panel places the cursor on the active multiline row', () => {
  const panel = renderPromptPanel({
    visualLines: ['first line', 'second line'],
    placeholder: 'Ask TideCode...',
    completionItems: [],
    completionIndex: 0,
    composerWidth: 60,
    cursorColumn: 3,
    cursorRow: 1,
  })

  assert.equal(panel.cursorRow, 2)
  assert.equal(panel.cursorColumn, 7)
  assert.equal(visibleWidth(panel.lines[panel.cursorRow]), visibleWidth(panel.lines[0]))
})

test('prompt suggestions keep the compose frame aligned while changing text', () => {
  const panel = renderPromptPanel({
    visualLines: ['/res'],
    placeholder: 'Ask TideCode...',
    completionItems: [
      { value: '/resume', label: '/resume', description: 'Browse and resume prior conversation sessions' },
      { value: '/reset', label: '/reset', description: 'Reset the current session' },
    ],
    completionIndex: 0,
    composerWidth: 60,
    cursorColumn: 4,
    cursorRow: 0,
  })

  const widths = panel.lines.map((line) => visibleWidth(line))
  assert.ok(widths.every((width) => width === widths[0]))
})
