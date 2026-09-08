import test from 'node:test'
import assert from 'node:assert/strict'
import { getTerminalInputAction, Win32TerminalInputDecoder } from '../../electron/cli/terminalInput'
import { TERMINAL_ESCAPE_CODE_TIMEOUT_MS } from '../../electron/cli/terminalLifecycle'

test('active composer key bindings map Enter, Tab, and Escape to distinct actions', () => {
  assert.deepEqual(getTerminalInputAction('\r', { name: 'return' }), { type: 'submit' })
  assert.deepEqual(getTerminalInputAction('\t', { name: 'tab' }), { type: 'alternate-submit' })
  assert.deepEqual(getTerminalInputAction('\u001b', { name: 'escape' }), { type: 'cancel' })
})

test('Shift+Tab keeps mode switching separate from queue submission', () => {
  assert.deepEqual(getTerminalInputAction('\t', { name: 'tab', shift: true }), { type: 'toggle-mode' })
})

test('modified Enter keys insert a newline instead of submitting', () => {
  assert.deepEqual(getTerminalInputAction('\r', { name: 'return', shift: true }), { type: 'newline' })
  assert.deepEqual(getTerminalInputAction('\x1b\r', { name: 'return', meta: true }), { type: 'newline' })
  assert.deepEqual(getTerminalInputAction('\x1b[13;2u', undefined), { type: 'newline' })
  assert.deepEqual(getTerminalInputAction('\x1b[27;3;13~', undefined), { type: 'newline' })
  assert.deepEqual(getTerminalInputAction('\n', undefined), { type: 'newline' })
})

test('Win32 input records preserve Shift+Enter and Alt+Enter modifiers', () => {
  const decoder = new Win32TerminalInputDecoder()

  assert.deepEqual(decoder.consume('\x1b[13;28;13;1;48;1_').actions, [{ type: 'newline' }])
  assert.deepEqual(decoder.consume('\x1b[13;28;13;1;34;1_').actions, [{ type: 'newline' }])
  assert.deepEqual(decoder.consume('\x1b[13;28;13;1;32;1_').actions, [{ type: 'submit' }])
})

test('Win32 input decoder handles split records and printable text', () => {
  const decoder = new Win32TerminalInputDecoder()

  assert.deepEqual(decoder.consume('\x1b[65;30;97;1;32').actions, [])
  assert.deepEqual(decoder.consume(';1_').actions, [{ type: 'insert', text: 'a' }])
  assert.deepEqual(decoder.consume('\x1b[65;30;65;1;48;2_').actions, [{ type: 'insert', text: 'AA' }])
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
