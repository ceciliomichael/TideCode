import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSelectionLines } from '../../electron/cli/terminalSelectionView'
import { renderPromptPanel } from '../../electron/cli/terminalPanels'
import { TerminalRegionHarness } from './terminalHarness'

function renderPrompt(text: string) {
  return renderPromptPanel({
    visualLines: [text],
    placeholder: 'Ask TideCode...',
    completionItems: [
      { value: '/resume', label: '/resume', description: 'Browse prior sessions' },
      { value: '/reset', label: '/reset', description: 'Reset the current session' },
    ],
    completionIndex: 0,
    composerWidth: 60,
    cursorColumn: text.length,
    cursorRow: 0,
  })
}

test('typing a slash command patches the changed row instead of repainting the whole prompt', () => {
  const harness = new TerminalRegionHarness()
  for (const text of ['/', '/r', '/re', '/res', '/resu', '/resum', '/resume']) {
    const panel = renderPrompt(text)
    harness.render(panel.lines, panel.cursorRow, panel.cursorColumn)
  }

  assert.equal(harness.fullFrameReplacements, 1)
  assert.ok(harness.rowPatches > 0)
  assert.equal(harness.lastPlan?.kind, 'patch')
  assert.equal(harness.snapshot().length, renderPrompt('/resume').lines.length)
})

test('moving selection changes rows in place without duplicating the picker frame', () => {
  const harness = new TerminalRegionHarness()
  const input = {
    title: 'Resume Previous Conversation',
    pageSize: 3,
    items: [
      { value: 'one', label: 'First session', description: 'Updated today' },
      { value: 'two', label: 'Second session', description: 'Updated yesterday' },
      { value: 'three', label: 'Third session', description: 'Updated last week' },
    ],
    footer: 'Esc to cancel',
  }

  for (const selectedIndex of [0, 1, 2, 1, 0]) {
    harness.render(buildSelectionLines(input, selectedIndex, 96), 0, 0)
  }

  assert.equal(harness.fullFrameReplacements, 1)
  assert.ok(harness.rowPatches >= 4)
  assert.equal(harness.snapshot().length, buildSelectionLines(input, 0, 96).length)
})
