import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acquireChatSendGate,
  acquireChatSendScopeGate,
  canBeginChatEditedSend,
  getChatSendScopeKey,
  releaseChatSendGate,
  releaseChatSendScopeGate,
  waitForChatSendScopeGateRelease,
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

test('an edited send can take over a gate owned by the active AI run', () => {
  assert.equal(
    canBeginChatEditedSend({
      actionInFlight: false,
      hasActiveRun: true,
      hasSubmissionInFlight: true,
    }),
    true,
  )
  assert.equal(
    canBeginChatEditedSend({
      actionInFlight: false,
      hasActiveRun: false,
      hasSubmissionInFlight: true,
    }),
    false,
  )
})

test('an edited send waits until the stopped AI run releases its gate', async () => {
  const scopeKey = getChatSendScopeKey('chat-a')
  const gate = { current: new Set([scopeKey]) }
  const releaseTimer = setTimeout(() => {
    releaseChatSendScopeGate(gate, scopeKey)
  }, 5)

  try {
    assert.equal(
      await waitForChatSendScopeGateRelease(gate, scopeKey, {
        pollIntervalMs: 1,
        timeoutMs: 100,
      }),
      true,
    )
    assert.equal(acquireChatSendScopeGate(gate, scopeKey), true)
  } finally {
    clearTimeout(releaseTimer)
  }
})
