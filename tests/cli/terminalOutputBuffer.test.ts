import assert from 'node:assert/strict'
import test from 'node:test'
import type { TerminalOutput } from '../../electron/cli/terminalOutput'
import { TerminalOutputBuffer } from '../../electron/cli/terminalOutputBuffer'

class RecordingOutput implements TerminalOutput {
  readonly writes: string[] = []

  write(text: string): void {
    this.writes.push(text)
  }

  moveCursor(): void {}

  cursorTo(): void {}
}

test('terminal output buffer exposes only one synchronized redraw write', () => {
  const output = new RecordingOutput()
  const buffer = new TerminalOutputBuffer()
  buffer.write('\x1b[?25l')
  buffer.moveCursor(0, -3)
  buffer.cursorTo(0)
  buffer.write('updated row')
  buffer.moveCursor(0, 3)
  buffer.cursorTo(8)
  buffer.write('\x1b[?25h')
  buffer.flushTo(output)

  assert.equal(output.writes.length, 1)
  assert.equal(output.writes[0], '\x1b[?2026h\x1b[?25l\x1b[3A\x1b[1Gupdated row\x1b[3B\x1b[9G\x1b[?25h\x1b[?2026l')
})
