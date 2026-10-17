import type { createTerminalToolSet } from '../../../../tools/terminalTools'

export function createTerminalInteractApi(terminal: ReturnType<typeof createTerminalToolSet>) {
  return terminal.interact_terminal
}
