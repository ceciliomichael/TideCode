import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acquireChatSendGate,
  acquireChatSendScopeGate,
  getChatSendScopeKey,
  releaseChatSendGate,
  releaseChatSendScopeGate,
} from '../src/lib/chatSendGate'

test('chat send gate accepts one synchronous submission and rejects duplicates until released', () => {
  const gate = { current: false }

  assert.equal(acquireChatSendGate(gate), true)
  assert.equal(acquireChatSendGate(gate), false)

  releaseChatSendGate(gate)

  assert.equal(acquireChatSendGate(gate), true)
})

test('chat send scope gate allows different chats to stream concurrently', () => {
  const gate = { current: new Set<string>() }
  const firstChat = getChatSendScopeKey('chat-a')
  const secondChat = getChatSendScopeKey('chat-b')

  assert.equal(acquireChatSendScopeGate(gate, firstChat), true)
  assert.equal(acquireChatSendScopeGate(gate, secondChat), true)
  assert.equal(acquireChatSendScopeGate(gate, firstChat), false)

  releaseChatSendScopeGate(gate, firstChat)

  assert.equal(acquireChatSendScopeGate(gate, firstChat), true)
  assert.equal(gate.current.has(secondChat), true)
})

test('chat send scope key keeps a new draft separate from persisted chats', () => {
  assert.notEqual(getChatSendScopeKey(null), getChatSendScopeKey('chat-a'))
  assert.equal(getChatSendScopeKey(null), getChatSendScopeKey(null))
})
