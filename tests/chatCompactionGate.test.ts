import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EMPTY_CHAT_COMPACTION_GATE_STATE,
  getCompactionBoundaryMessageCount,
  hasMinimumCompactionMessages,
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

test('initial compaction requires at least three conversation messages', () => {
  const messages = [
    { content: 'Prompt', id: 'user-1', role: 'user' as const, timestamp: 1 },
    { content: 'Answer', id: 'assistant-1', role: 'assistant' as const, timestamp: 2 },
  ]

  assert.equal(getCompactionBoundaryMessageCount(messages, []), 2)
  assert.equal(hasMinimumCompactionMessages(messages, []), false)
  assert.equal(hasMinimumCompactionMessages([
    ...messages,
    { content: 'Next prompt', id: 'user-2', role: 'user' as const, timestamp: 3 },
  ], []), true)
})

test('a compaction marker resets the three-message eligibility boundary', () => {
  const marker = {
    anchorUserMessageId: 'user-1',
    compactionId: 'compaction-1',
    createdAt: 3,
    detailSections: [],
  }
  const compactedMessages = [
    { content: 'Prompt', id: 'user-1', role: 'user' as const, timestamp: 1 },
    { content: 'Answer', id: 'assistant-1', role: 'assistant' as const, timestamp: 2 },
  ]
  const twoMessagesAfterBoundary = [
    ...compactedMessages,
    { content: 'Next prompt', id: 'user-2', role: 'user' as const, timestamp: 4 },
    { content: 'Next answer', id: 'assistant-2', role: 'assistant' as const, timestamp: 5 },
  ]

  assert.equal(getCompactionBoundaryMessageCount(twoMessagesAfterBoundary, [marker]), 2)
  assert.equal(hasMinimumCompactionMessages(twoMessagesAfterBoundary, [marker]), false)
  assert.equal(hasMinimumCompactionMessages([
    ...twoMessagesAfterBoundary,
    { content: 'Third message', id: 'user-3', role: 'user' as const, timestamp: 6 },
  ], [marker]), true)
})

test('tool bookkeeping does not count toward the three-message compaction minimum', () => {
  const messages = [
    { content: 'Prompt', id: 'user-1', role: 'user' as const, timestamp: 1 },
    { content: '', id: 'tool-1', role: 'tool' as const, timestamp: 2 },
    { content: 'Answer', id: 'assistant-1', role: 'assistant' as const, timestamp: 3 },
  ]

  assert.equal(getCompactionBoundaryMessageCount(messages, []), 2)
  assert.equal(hasMinimumCompactionMessages(messages, []), false)
})

test('blank conversation ids cannot create a global compaction lock', () => {
  const nextState = reduceChatCompactionGate(EMPTY_CHAT_COMPACTION_GATE_STATE, {
    conversationId: '   ',
    type: 'compaction_committed',
  })

  assert.equal(nextState, EMPTY_CHAT_COMPACTION_GATE_STATE)
  assert.equal(isChatCompactionBlocked(nextState, null), false)
})
