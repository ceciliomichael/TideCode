import { planTerminalRegionUpdate, type TerminalRegionUpdatePlan } from '../../electron/cli/terminalRedraw'
import type { TerminalOutput } from '../../electron/cli/terminalOutput'

const ESC = String.fromCharCode(27)

export class TerminalRegionHarness {
  private lines: string[] = []
  private hasFrame = false

  fullFrameReplacements = 0
  rowPatches = 0
  lastPlan: TerminalRegionUpdatePlan | null = null
  cursorRow = 0
  cursorColumn = 0

  render(nextLines: readonly string[], cursorRow: number, cursorColumn: number): void {
    const plan = this.hasFrame ? planTerminalRegionUpdate(this.lines, nextLines) : { kind: 'replace' as const, lines: nextLines }
    this.lastPlan = plan

    if (plan.kind === 'replace') {
      this.fullFrameReplacements += 1
      this.lines = [...plan.lines]
    } else {
      this.rowPatches += plan.patches.length
      for (const patch of plan.patches) this.lines[patch.row] = patch.text
    }

    this.hasFrame = true
    this.cursorRow = cursorRow
    this.cursorColumn = cursorColumn
  }

  snapshot(): readonly string[] {
    return this.lines
  }
}

export class TerminalGridOutput implements TerminalOutput {
  readonly width: number
  readonly writes: string[] = []
  private rows: string[] = ['']
  private row = 0
  private column = 0

  constructor(width = 120) {
    this.width = width
  }

  write(text: string): void {
    this.writes.push(text)
    let index = 0
    while (index < text.length) {
      if (text[index] === ESC) {
        const sequence = text.slice(index + 1).match(/^\[([?0-9;]*)([A-Za-z])/u)
        if (sequence) {
          const full = `${ESC}${sequence[0]}`
          if (sequence[1] === '2' && sequence[2] === 'K') this.rows[this.row] = ''
          if (sequence[1] === '2' && sequence[2] === 'J') {
            this.rows = ['']
            this.row = 0
            this.column = 0
          }
          if (sequence[2] === 'H') {
            this.row = 0
            this.column = 0
          }
          index += full.length
          continue
        }
      }

      if (text[index] === ESC) {
        const style = text.slice(index + 1).match(/^\[[0-9;]*m/u)
        if (style) {
          index += style[0].length + 1
          continue
        }
      }

      const character = text[index]
      if (character === '\n') {
        this.row += 1
        this.column = 0
        this.ensureRow()
      } else if (character === '\r') {
        this.column = 0
      } else {
        this.ensureRow()
        const current = this.rows[this.row]
        this.rows[this.row] = `${current.slice(0, this.column)}${character}${current.slice(this.column + 1)}`.padEnd(Math.min(this.width, this.column + 1), ' ')
        this.column += 1
      }
      index += 1
    }
  }

  moveCursor(dx: number, dy: number): void {
    this.column = Math.max(0, Math.min(this.width, this.column + dx))
    this.row = Math.max(0, this.row + dy)
    this.ensureRow()
  }

  cursorTo(column: number): void {
    this.column = Math.max(0, Math.min(this.width, column))
    this.ensureRow()
  }

  visibleRows(): string[] {
    return this.rows.map((line) => line.trimEnd())
  }

  private ensureRow(): void {
    while (this.rows.length <= this.row) this.rows.push('')
  }
}
