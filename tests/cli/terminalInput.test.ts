import test from 'node:test'
import assert from 'node:assert/strict'
import { getTerminalInputAction } from '../../electron/cli/terminalInput'
import { TERMINAL_ESCAPE_CODE_TIMEOUT_MS } from '../../electron/cli/terminalLifecycle'

test('active composer key bindings map Enter, Tab, and Escape to distinct actions', () => {
  assert.deepEqual(getTerminalInputAction('\r', { name: 'return' }), { type: 'submit' })
  assert.deepEqual(getTerminalInputAction('\t', { name: 'tab' }), { type: 'alternate-submit' })
  assert.deepEqual(getTerminalInputAction('\u001b', { name: 'escape' }), { type: 'cancel' })
})

test('Shift+Tab keeps mode switching separate from queue submission', () => {
  assert.deepEqual(getTerminalInputAction('\t', { name: 'tab', shift: true }), { type: 'toggle-mode' })
})

test('Ctrl+V and Alt+V map to paste-clipboard action', () => {
  assert.deepEqual(getTerminalInputAction('\u0016', { name: 'v', ctrl: true }), { type: 'paste-clipboard' })
  assert.deepEqual(getTerminalInputAction('\u001bv', { name: 'v', meta: true }), { type: 'paste-clipboard' })
  assert.deepEqual(getTerminalInputAction('\x1b[118;3u', undefined), { type: 'paste-clipboard' })
  assert.deepEqual(getTerminalInputAction('\u0016', undefined), { type: 'paste-clipboard' })
})

test('uses a short escape disambiguation timeout for responsive cancellation', () => {
  assert.ok(TERMINAL_ESCAPE_CODE_TIMEOUT_MS <= 50)
})
