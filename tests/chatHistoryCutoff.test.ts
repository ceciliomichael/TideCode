import assert from 'node:assert/strict'
import test from 'node:test'
import { applyHistoryCutoff } from '../src/hooks/chatHistoryCutoff'
import type { Message } from '../src/types/chat'

function message(id: string, role: Message['role']): Message {
  return {
    content: id,
    id,
    role,
    timestamp: 1,
  }
}

test('history cutoff keeps the edited user turn and removes every later message', () => {
  const messages = [
    message('user-1', 'user'),
    message('assistant-1', 'assistant'),
    message('user-2', 'user'),
    message('assistant-2', 'assistant'),
    message('user-3', 'user'),
  ]

  assert.deepEqual(
    applyHistoryCutoff(messages, 'user-2').map((entry) => entry.id),
    ['user-1', 'assistant-1', 'user-2'],
  )
})

test('history cutoff is non-destructive when the target is absent or cleared', () => {
  const messages = [message('user-1', 'user'), message('assistant-1', 'assistant')]

  assert.equal(applyHistoryCutoff(messages, null), messages)
  assert.equal(applyHistoryCutoff(messages, 'missing'), messages)
})
