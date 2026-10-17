import type { createTerminalToolSet } from '../../../../tools/terminalTools'

export function createTerminalTerminateApi(terminal: ReturnType<typeof createTerminalToolSet>) {
  return terminal.terminate_terminal
}
