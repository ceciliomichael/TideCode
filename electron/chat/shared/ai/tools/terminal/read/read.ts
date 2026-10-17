import type { createTerminalToolSet } from '../../../../tools/terminalTools'

export function createTerminalReadApi(terminal: ReturnType<typeof createTerminalToolSet>) {
  return terminal.read_terminal
}
