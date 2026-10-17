import type { createTerminalToolSet } from '../../../../tools/terminalTools'

export function createTerminalExecuteApi(terminal: ReturnType<typeof createTerminalToolSet>) {
  return terminal.execute_terminal
}
