import test from 'node:test'
import assert from 'node:assert/strict'
import { clipAnsiLine, stripAnsi, truncateVisible, visibleWidth, wrapVisible } from '../../electron/cli/terminalText'

test('terminal text measurement ignores ANSI styling and counts wide characters', () => {
  assert.equal(visibleWidth('\x1b[38;5;80mhello\x1b[0m'), 5)
  assert.equal(visibleWidth('界'), 2)
  assert.equal(stripAnsi('\x1b[1mTideCode\x1b[0m'), 'TideCode')
})

test('terminal text truncates without overflowing its display width', () => {
  const text = truncateVisible('C:/workspace/a-long-project-name', 16)
  assert.ok(visibleWidth(text) <= 16)
  assert.equal(visibleWidth(clipAnsiLine('123456789', 4)), 4)
})

test('terminal text wraps long words and preserves readable whitespace', () => {
  const lines = wrapVisible('read this extremely-long-file-name carefully', 12)
  assert.ok(lines.length > 2)
  assert.ok(lines.every((line) => visibleWidth(line) <= 12))
})
