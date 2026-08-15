import assert from 'node:assert/strict'
import test from 'node:test'
import { TerminalFrameBuffer } from '../../electron/cli/terminalFrameBuffer'
import type { TerminalOutput } from '../../electron/cli/terminalOutput'

class RecordingOutput implements TerminalOutput {
  writes: string[] = []
  moves: Array<{ dx: number; dy: number }> = []
  cursors: number[] = []

  write(text: string): void {
    this.writes.push(text)
  }

  moveCursor(dx: number, dy: number): void {
    this.moves.push({ dx, dy })
  }

  cursorTo(column: number): void {
    this.cursors.push(column)
  }
}

test('terminal frame buffer repaints rows in place and clears stale content below', () => {
  const output = new RecordingOutput()
  const frame = new TerminalFrameBuffer(output)

  frame.write('first row\nsecond row\nthird row')
  frame.moveCursor(0, -2)
  frame.cursorTo(3)
  frame.clearStaleRows()

  assert.equal(output.writes.some((write) => write.includes('\x1b[2J')), false)
  assert.equal(output.writes.some((write) => write.includes('\x1b[2K')), true)
  assert.equal(output.writes.some((write) => write.includes('\x1b[J')), true)
  assert.deepEqual(output.moves, [{ dx: 0, dy: -2 }, { dx: 0, dy: 2 }, { dx: 0, dy: -2 }])
  assert.equal(output.cursors.at(-1), 3)
})
