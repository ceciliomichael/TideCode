import assert from 'node:assert/strict'
import test from 'node:test'
import { getCompactionAfterMessageId } from '../src/lib/chatCompactionBoundary'
import type { Message } from '../src/types/chat'

test('compaction boundary ignores hidden synthetic tool result messages', () => {
  const messages: Message[] = [
    { content: 'Prompt', id: 'user-1', role: 'user', timestamp: 1 },
    { content: 'Visible assistant work', id: 'assistant-1', role: 'assistant', timestamp: 2 },
    { content: 'Synthetic tool result', id: 'tool-1', role: 'tool', timestamp: 3 },
  ]

  assert.equal(getCompactionAfterMessageId(messages), 'assistant-1')
})

test('compaction boundary skips an empty streaming placeholder before compaction', () => {
  const messages: Message[] = [
    { content: 'Prompt', id: 'user-1', role: 'user', timestamp: 1 },
    { content: '', id: 'assistant-placeholder', reasoningContent: '', role: 'assistant', timestamp: 2 },
  ]

  assert.equal(getCompactionAfterMessageId(messages), 'user-1')
})

test('compaction boundary returns null when no transcript message is renderable', () => {
  const messages: Message[] = [
    { content: 'Synthetic tool result', id: 'tool-1', role: 'tool', timestamp: 1 },
  ]

  assert.equal(getCompactionAfterMessageId(messages), null)
})
