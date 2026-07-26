import assert from 'node:assert/strict'
import test from 'node:test'
import { buildConversationCompaction } from '../../electron/history/conversationCompaction'
import type { ConversationRecord } from '../../src/types/chat'

function buildConversation(
  id: string,
  compaction?: ConversationRecord['compaction'],
): ConversationRecord {
  return {
    agentContextRootPath: '/workspace',
    chatMode: 'agent',
    ...(compaction ? { compaction } : {}),
    createdAt: 1,
    folderId: null,
    id,
    messages: [],
    title: 'Thread',
    updatedAt: 1,
  }
}

test('buildConversationCompaction preserves ancestry and assigns chronological sequence numbers', () => {
  const original = buildConversation('original')
  const firstCompaction = buildConversation('compact-1', {
    compactedAt: 10,
    depth: 1,
    rootConversationId: 'original',
    sequence: 1,
    sourceConversationId: 'original',
  })

  assert.deepEqual(buildConversationCompaction(firstCompaction, [original, firstCompaction], 20), {
    compactedAt: 20,
    depth: 2,
    rootConversationId: 'original',
    sequence: 2,
    sourceConversationId: 'compact-1',
  })
})
