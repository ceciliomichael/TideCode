import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EMPTY_CHAT_COMPACTION_GATE_STATE,
  isChatCompactionBlocked,
  reduceChatCompactionGate,
} from '../src/lib/chatCompactionGate'

test('a successful compaction blocks only that conversation', () => {
  const nextState = reduceChatCompactionGate(EMPTY_CHAT_COMPACTION_GATE_STATE, {
    conversationId: 'conversation-1',
    type: 'compaction_committed',
  })

  assert.equal(isChatCompactionBlocked(nextState, 'conversation-1'), true)
  assert.equal(isChatCompactionBlocked(nextState, 'conversation-2'), false)
})

test('a real accepted turn releases the compaction lock for its conversation', () => {
  const compactedState = reduceChatCompactionGate(EMPTY_CHAT_COMPACTION_GATE_STATE, {
    conversationId: 'conversation-1',
    type: 'compaction_committed',
  })
  const nextState = reduceChatCompactionGate(compactedState, {
    conversationId: 'conversation-1',
    type: 'real_turn_accepted',
  })

  assert.equal(isChatCompactionBlocked(nextState, 'conversation-1'), false)
})

test('repeated compaction events and unlock events are idempotent', () => {
  const compactedState = reduceChatCompactionGate(
    reduceChatCompactionGate(EMPTY_CHAT_COMPACTION_GATE_STATE, {
      conversationId: 'conversation-1',
      type: 'compaction_committed',
    }),
    {
      conversationId: 'conversation-1',
      type: 'compaction_committed',
    },
  )
  const unlockedState = reduceChatCompactionGate(
    reduceChatCompactionGate(compactedState, {
      conversationId: 'conversation-1',
      type: 'real_turn_accepted',
    }),
    {
      conversationId: 'conversation-1',
      type: 'real_turn_accepted',
    },
  )

  assert.equal(compactedState.blockedConversationIds.size, 1)
  assert.equal(unlockedState.blockedConversationIds.size, 0)
})

test('blank conversation ids cannot create a global compaction lock', () => {
  const nextState = reduceChatCompactionGate(EMPTY_CHAT_COMPACTION_GATE_STATE, {
    conversationId: '   ',
    type: 'compaction_committed',
  })

  assert.equal(nextState, EMPTY_CHAT_COMPACTION_GATE_STATE)
  assert.equal(isChatCompactionBlocked(nextState, null), false)
})
