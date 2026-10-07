import assert from 'node:assert/strict'
import test from 'node:test'
import { getConversationBranchMessages, getConversationBranchTitle } from '../../src/lib/chatBranching'
import type { Message } from '../../src/types/chat'

const messages: Message[] = [
  { id: 'user-1', role: 'user', content: 'First request', timestamp: 1 },
  { id: 'assistant-1', role: 'assistant', content: 'First response', timestamp: 2 },
  { id: 'user-2', role: 'user', content: 'Second request', timestamp: 3 },
  { id: 'assistant-2', role: 'assistant', content: 'Second response', timestamp: 4 },
]

test('conversation branching keeps transcript through the selected assistant message', () => {
  assert.deepEqual(
    getConversationBranchMessages(messages, 'assistant-1').map((message) => message.id),
    ['user-1', 'assistant-1'],
  )
})

test('conversation branching rejects user or missing message ids', () => {
  assert.throws(() => getConversationBranchMessages(messages, 'user-2'), /assistant message selected for branching/)
  assert.throws(() => getConversationBranchMessages(messages, 'missing'), /assistant message selected for branching/)
})

test('branched conversations use a Branch title prefix', () => {
  assert.equal(getConversationBranchTitle('Fix remote chat'), 'Branch · Fix remote chat')
  assert.equal(getConversationBranchTitle('  Fix remote chat  '), 'Branch · Fix remote chat')
  assert.equal(getConversationBranchTitle(''), 'Branch')
})
