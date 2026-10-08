import assert from 'node:assert/strict'
import test from 'node:test'
import { retainConversationRuntimes } from '../src/hooks/conversationRuntimeRetention'
import type { ConversationRecord } from '../src/types/chat'

function runtime(id: string, content = 'hello') {
  return {
    activeStreamId: null as string | null, isSending: false,
    conversation: { id, messages: [{ content }] } as ConversationRecord,
  }
}

test('conversation retention protects selected and running chats while keeping three recent inactive chats', () => {
  const states = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [String(index), runtime(String(index))]))
  states['1'].isSending = true
  states['2'].activeStreamId = 'stream'
  const lastUsed = new Map(Object.keys(states).map((id) => [id, Number(id)]))
  const retained = retainConversationRuntimes(states, '0', new Set(['3']), lastUsed)
  assert.deepEqual(Object.keys(retained), ['0', '1', '2', '3', '7', '8', '9'])
  assert.equal(Object.keys(states).length, 10)
  assert.equal(retainConversationRuntimes(retained, '0', new Set(['3']), lastUsed), retained)
})

test('oversized inactive conversations are evicted without dropping an oversized active chat', () => {
  const states = { large: runtime('large', 'x'.repeat(9 * 1024 * 1024)), active: runtime('active', 'y'.repeat(9 * 1024 * 1024)), small: runtime('small') }
  const retained = retainConversationRuntimes(states, 'active', new Set(), new Map())
  assert.deepEqual(Object.keys(retained), ['active', 'small'])
})
