import { visibleWidth } from './terminalText'
import type { TerminalOutput } from './terminalOutput'

/**
 * Paints a complete terminal frame in place without clearing the screen first.
 * Resize events can reflow the old frame, so each newly written row is erased
 * at its current position and stale rows are cleared after the new frame.
 */
export class TerminalFrameBuffer implements TerminalOutput {
  private row = 0
  private column = 0
  private highestRow = 0

  constructor(private readonly output: TerminalOutput) {}

  write(text: string): void {
    const segments = text.split('\n')
    segments.forEach((segment, index) => {
      if (this.column === 0) this.output.write('\x1b[2K')
      if (segment.length > 0) {
        this.output.write(segment)
        this.column += visibleWidth(segment)
      }

      if (index < segments.length - 1) {
        this.output.write('\n')
        this.row += 1
        this.highestRow = Math.max(this.highestRow, this.row)
        this.column = 0
      }
    })
  }

  moveCursor(dx: number, dy: number): void {
    this.output.moveCursor(dx, dy)
    this.column = Math.max(0, this.column + dx)
    this.row = Math.max(0, this.row + dy)
    this.highestRow = Math.max(this.highestRow, this.row)
  }

  cursorTo(column: number): void {
    this.output.cursorTo(column)
    this.column = Math.max(0, column)
  }

  clearStaleRows(): void {
    const savedColumn = this.column
    const rowsToBottom = Math.max(0, this.highestRow - this.row)

    if (rowsToBottom > 0) this.moveCursor(0, rowsToBottom)
    this.cursorTo(0)
    this.output.write('\x1b[2K\x1b[J')
    if (rowsToBottom > 0) this.moveCursor(0, -rowsToBottom)
    this.cursorTo(savedColumn)
  }
}
