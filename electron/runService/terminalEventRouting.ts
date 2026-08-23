import type { TerminalBrokerEvent } from '../../src/types/chat'

export function hasTerminalEventRecipient(
  event: TerminalBrokerEvent,
  registeredClientIds: ReadonlySet<string> | undefined,
) {
  if (!registeredClientIds || registeredClientIds.size === 0 || event.clientIds.length === 0) {
    return false
  }
  return event.clientIds.some((clientId) => registeredClientIds.has(clientId))
}
