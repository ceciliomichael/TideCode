import { TerminalBroker } from './terminalBroker'

let terminalBroker: TerminalBroker | null = null

export function getTerminalBroker() {
  terminalBroker ??= new TerminalBroker()
  return terminalBroker
}

export async function shutdownTerminalBroker() {
  const current = terminalBroker
  terminalBroker = null
  await current?.shutdown()
}
