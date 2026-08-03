import assert from 'node:assert/strict'
import test from 'node:test'
import { reduceChatCompactionStatus } from '../src/lib/chatCompactionStatus'
import type { ChatStreamEvent } from '../src/types/chat'

const startedEvent: ChatStreamEvent = {
  attemptId: 'attempt-1',
  conversationId: 'conversation-1',
  streamId: 'stream-1',
  type: 'compaction_started',
}

test('compaction lifecycle transitions from compacting to compacted', () => {
  const compacting = reduceChatCompactionStatus(null, startedEvent, 'conversation-1')
  assert.deepEqual(compacting, {
    attemptId: 'attempt-1',
    phase: 'compacting',
    streamId: 'stream-1',
  })

  const compacted = reduceChatCompactionStatus(compacting, {
    compactionId: 'compaction-1',
    conversationId: 'conversation-1',
    streamId: 'stream-1',
    type: 'compaction_committed',
  }, 'conversation-1')
  assert.deepEqual(compacted, {
    attemptId: 'attempt-1',
    compactionId: 'compaction-1',
    phase: 'compacted',
    streamId: 'stream-1',
  })
})

test('failed or terminal compaction clears only an in-flight status', () => {
  const compacting = reduceChatCompactionStatus(null, startedEvent, 'conversation-1')
  assert.equal(reduceChatCompactionStatus(compacting, {
    attemptId: 'attempt-1',
    conversationId: 'conversation-1',
    reason: 'unavailable',
    streamId: 'stream-1',
    type: 'compaction_failed',
  }, 'conversation-1'), null)

  const compacted = {
    attemptId: 'attempt-1',
    compactionId: 'compaction-1',
    phase: 'compacted' as const,
    streamId: 'stream-1',
  }
  assert.deepEqual(reduceChatCompactionStatus(compacted, {
    streamId: 'stream-1',
    type: 'completed',
  }, 'conversation-1'), compacted)
})

test('compaction lifecycle ignores events from another conversation', () => {
  assert.equal(reduceChatCompactionStatus(null, {
    ...startedEvent,
    conversationId: 'conversation-2',
  }, 'conversation-1'), null)
})
