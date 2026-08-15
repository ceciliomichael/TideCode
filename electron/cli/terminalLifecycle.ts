import readline from 'node:readline'
import { setColorEnabled } from './renderer'

let keypressEventsInitialized = false

// Node waits 500 ms before deciding a lone Escape byte is not the start of an
// ANSI key sequence. That default makes stopping a turn feel delayed. Arrow,
// function, and modified keys arrive as a single terminal write in normal TTYs,
// so a short timeout keeps those sequences intact while making Escape immediate.
export const TERMINAL_ESCAPE_CODE_TIMEOUT_MS = 35

export function ensureKeypressEvents(): void {
  if (keypressEventsInitialized) return
  const keypressOptions = {
    escapeCodeTimeout: TERMINAL_ESCAPE_CODE_TIMEOUT_MS,
  } as unknown as readline.Interface
  readline.emitKeypressEvents(process.stdin, keypressOptions)
  keypressEventsInitialized = true
}

export class TerminalLifecycle {
  private isActive = false

  start(): void {
    if (this.isActive) return
    this.isActive = true
    setColorEnabled(process.env.NO_COLOR === undefined)
  }

  stop(): void {
    if (!this.isActive) return
    this.isActive = false
    process.stdout.write('\x1b[?25h\x1b[0 q\x1b[0m')
    setColorEnabled(true)
  }

  enableRawInput(): void {
    ensureKeypressEvents()
    try {
      process.stdin.setRawMode(true)
    } catch {
      // Non-standard TTY implementations may not expose raw mode.
    }
    process.stdin.resume()
  }

  disableRawInput(): void {
    try {
      process.stdin.setRawMode(false)
    } catch {
      // Non-standard TTY implementations may not expose raw mode.
    }
  }

  get active(): boolean {
    return this.isActive
  }
}
