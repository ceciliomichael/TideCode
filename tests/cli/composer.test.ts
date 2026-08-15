import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyComposerAction,
  composerText,
  createComposerState,
  getComposerCursorPosition,
  getComposerVisualLines,
  recordComposerHistory,
  sanitizeComposerHistoryText,
} from '../../electron/cli/composer'

test('composer supports multiline editing and joining lines', () => {
  let state = createComposerState()
  state = applyComposerAction(state, { type: 'insert', text: 'hello' })
  state = applyComposerAction(state, { type: 'newline' })
  state = applyComposerAction(state, { type: 'insert', text: 'world' })
  assert.equal(composerText(state), 'hello\nworld')

  state = applyComposerAction(state, { type: 'backspace' })
  assert.equal(composerText(state), 'hello\nworl')
  state = applyComposerAction(state, { type: 'end' })
  state = applyComposerAction(state, { type: 'delete' })
  assert.equal(composerText(state), 'hello\nworl')
})

test('composer keeps bounded history and navigates it from an empty prompt', () => {
  const first = recordComposerHistory(createComposerState(), 'first request')
  const second = recordComposerHistory(first, 'second request')
  let state = applyComposerAction(second, { type: 'move-up' })
  assert.equal(composerText(state), 'second request')
  state = applyComposerAction(state, { type: 'move-up' })
  assert.equal(composerText(state), 'first request')
  state = applyComposerAction(state, { type: 'move-down' })
  assert.equal(composerText(state), 'second request')
})

test('composer history redacts API keys from provider-add commands', () => {
  const command = '/provider add Example https://example.test/v1 sk-secret-value'
  assert.equal(sanitizeComposerHistoryText(command), '/provider add Example https://example.test/v1 [redacted]')
  assert.equal(
    recordComposerHistory(createComposerState(), command).history[0],
    '/provider add Example https://example.test/v1 [redacted]',
  )
})

test('composer reports wrapped cursor positions within terminal bounds', () => {
  let state = createComposerState()
  state = applyComposerAction(state, { type: 'insert', text: '1234567890' })
  const lines = getComposerVisualLines(state, 4)
  const cursor = getComposerCursorPosition(state, 4)
  assert.equal(lines.length, 3)
  assert.equal(cursor.lineIndex, 2)
  assert.ok(cursor.column < 4)
})
