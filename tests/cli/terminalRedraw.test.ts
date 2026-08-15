import test from 'node:test'
import assert from 'node:assert/strict'
import { getChangedTerminalRows } from '../../electron/cli/terminalRedraw'

test('terminal redraw identifies only rows that changed', () => {
  const previous = ['header', 'first option', 'second option', 'footer']
  const next = ['header', 'first option', 'selected option', 'footer']
  assert.deepEqual(getChangedTerminalRows(previous, next), [2])
})

test('terminal redraw treats a changed frame height as a full frame change', () => {
  const changed = getChangedTerminalRows(['header', 'footer'], ['header', 'option', 'footer'])
  assert.deepEqual(changed, [1, 2])
})
