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
  const firstChat = getChatSendScopeKey('chat-a', 'draft-a')
  const secondChat = getChatSendScopeKey('chat-b', 'draft-a')

  assert.equal(acquireChatSendScopeGate(gate, firstChat), true)
  assert.equal(acquireChatSendScopeGate(gate, secondChat), true)
  assert.equal(acquireChatSendScopeGate(gate, firstChat), false)

  releaseChatSendScopeGate(gate, firstChat)

  assert.equal(acquireChatSendScopeGate(gate, firstChat), true)
  assert.equal(gate.current.has(secondChat), true)
})

test('chat send scope key keeps a new draft separate from persisted chats', () => {
  assert.notEqual(getChatSendScopeKey(null, 'draft-a'), getChatSendScopeKey('chat-a', 'draft-a'))
  assert.equal(getChatSendScopeKey(null, 'draft-a'), getChatSendScopeKey(null, 'draft-a'))
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
  const scopeKey = getChatSendScopeKey('chat-a', 'draft-a')
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


test('new drafts in the same project can send independently while their responses run', () => {
  const gate = { current: new Set<string>() }
  const firstDraft = getChatSendScopeKey(null, 'draft-a')
  const secondDraft = getChatSendScopeKey(null, 'draft-b')

  assert.equal(acquireChatSendScopeGate(gate, firstDraft), true)
  assert.equal(acquireChatSendScopeGate(gate, secondDraft), true)
  assert.equal(acquireChatSendScopeGate(gate, secondDraft), false)
  releaseChatSendScopeGate(gate, firstDraft)
  assert.equal(gate.current.has(secondDraft), true)
})
