import assert from 'node:assert/strict'
import test from 'node:test'
import type { TerminalBrokerEvent } from '../../src/types/chat'
import { hasTerminalEventRecipient } from '../../electron/runService/terminalEventRouting'

function createOutputEvent(clientIds: string[]): TerminalBrokerEvent {
  return {
    clientIds,
    legacySessionId: 17,
    output: {
      brokerSessionId: 'broker-session',
      data: 'terminal output',
      endCursor: 15,
      outputEvicted: false,
      startCursor: 0,
    },
    type: 'terminal_output',
  }
}

test('AI terminal output is not routed to an unrelated desktop socket', () => {
  const event = createOutputEvent(['terminal-broker-ai:run-1'])
  const desktopClientIds = new Set(['desktop-terminal-client'])

  assert.equal(hasTerminalEventRecipient(event, desktopClientIds), false)
})

test('terminal output is routed when one attached client belongs to the socket', () => {
  const event = createOutputEvent(['remote-terminal-client', 'desktop-terminal-client'])
  const desktopClientIds = new Set(['desktop-terminal-client'])

  assert.equal(hasTerminalEventRecipient(event, desktopClientIds), true)
})

test('terminal events without attached socket clients are not broadcast', () => {
  assert.equal(hasTerminalEventRecipient(createOutputEvent([]), new Set(['desktop-terminal-client'])), false)
  assert.equal(hasTerminalEventRecipient(createOutputEvent(['ai-client']), undefined), false)
})
