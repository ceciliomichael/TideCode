import assert from 'node:assert/strict'
import test from 'node:test'
import { pasteTextIntoTerminal } from '../../src/components/chat/workspaceTerminalPanel/terminalPaste'

test('multiline terminal text is passed to xterm as one paste operation', () => {
  const pastedValues: string[] = []
  const terminal = {
    paste(value: string) {
      pastedValues.push(value)
    },
  }
  const text = 'Please update this function:\n```ts\nconst answer = 42\n```'

  assert.equal(pasteTextIntoTerminal(terminal, text), true)
  assert.deepEqual(pastedValues, [text])
})

test('terminal paste preserves CRLF content for xterm to normalize', () => {
  const pastedValues: string[] = []
  const terminal = { paste: (value: string) => pastedValues.push(value) }
  const text = 'first line\r\nsecond line\r\nthird line'

  pasteTextIntoTerminal(terminal, text)
  assert.deepEqual(pastedValues, [text])
})

test('empty clipboard text does not trigger a paste operation', () => {
  let pasteCount = 0
  const terminal = { paste: () => { pasteCount += 1 } }

  assert.equal(pasteTextIntoTerminal(terminal, ''), false)
  assert.equal(pasteCount, 0)
})
