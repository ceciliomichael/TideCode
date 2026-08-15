import readline from 'node:readline'

export interface TerminalOutput {
  write(text: string): void
  moveCursor(dx: number, dy: number): void
  cursorTo(column: number): void
}

export const processTerminalOutput: TerminalOutput = {
  write: (text) => process.stdout.write(text),
  moveCursor: (dx, dy) => readline.moveCursor(process.stdout, dx, dy),
  cursorTo: (column) => readline.cursorTo(process.stdout, column),
}
