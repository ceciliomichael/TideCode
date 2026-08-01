import assert from 'node:assert/strict'
import test from 'node:test'
import { acquireChatSendGate, releaseChatSendGate } from '../src/lib/chatSendGate'

test('chat send gate accepts one synchronous submission and rejects duplicates until released', () => {
  const gate = { current: false }

  assert.equal(acquireChatSendGate(gate), true)
  assert.equal(acquireChatSendGate(gate), false)

  releaseChatSendGate(gate)

  assert.equal(acquireChatSendGate(gate), true)
})
