import type { TerminalOutput } from './terminalOutput'

const SYNCHRONIZED_UPDATE_START = '\x1b[?2026h'
const SYNCHRONIZED_UPDATE_END = '\x1b[?2026l'

function relativeCursorSequence(delta: number, positiveCode: string, negativeCode: string): string {
  if (delta === 0) return ''
  return `\x1b[${Math.abs(delta)}${delta > 0 ? positiveCode : negativeCode}`
}

export class TerminalOutputBuffer implements TerminalOutput {
  private readonly chunks: string[] = []

  write(text: string): void {
    this.chunks.push(text)
  }

  moveCursor(dx: number, dy: number): void {
    this.chunks.push(relativeCursorSequence(dy, 'B', 'A'))
    this.chunks.push(relativeCursorSequence(dx, 'C', 'D'))
  }

  cursorTo(column: number): void {
    this.chunks.push(`\x1b[${Math.max(0, column) + 1}G`)
  }

  flushTo(output: TerminalOutput): void {
    output.write(`${SYNCHRONIZED_UPDATE_START}${this.chunks.join('')}${SYNCHRONIZED_UPDATE_END}`)
    this.chunks.length = 0
  }
}
