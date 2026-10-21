import assert from 'node:assert/strict'
import test from 'node:test'
import { projectHistoryCutoff } from '../src/hooks/chatHistoryCutoff'
import type { Message } from '../src/types/chat'

function message(id: string, role: Message['role']): Message {
  return {
    content: id,
    id,
    role,
    timestamp: 1,
  }
}

test('revert cuts active context at the edited user turn while preserving every visible message', () => {
  const messages = [
    message('user-1', 'user'),
    message('assistant-1', 'assistant'),
    message('user-2', 'user'),
    message('assistant-2', 'assistant'),
    message('user-3', 'user'),
  ]

  const reverted = projectHistoryCutoff(messages, 'user-2')
  assert.deepEqual(
    reverted.contextMessages.map((entry) => entry.id),
    ['user-1', 'assistant-1', 'user-2'],
  )
  assert.equal(reverted.displayMessages, messages)
  assert.equal(reverted.displayMessages[3], messages[3])
})

test('history cutoff is non-destructive when the target is absent or cleared', () => {
  const messages = [message('user-1', 'user'), message('assistant-1', 'assistant')]

  for (const target of [null, 'missing', 'assistant-1']) {
    const projected = projectHistoryCutoff(messages, target)
    assert.equal(projected.contextMessages, messages)
    assert.equal(projected.displayMessages, messages)
  }
})

test('submitting the replacement removes the later branch from both context and display immediately', () => {
  const messages = [message('user-1', 'user'), message('assistant-1', 'assistant'), message('user-2', 'user'), message('assistant-2', 'assistant')]
  const projected = projectHistoryCutoff(messages, 'user-2', {
    attachments: [], content: 'Replacement request.', messageId: 'user-2',
  })
  assert.deepEqual(projected.contextMessages.map((entry) => entry.id), ['user-1', 'assistant-1', 'user-2'])
  assert.equal(projected.contextMessages[2].content, 'Replacement request.')
  assert.equal(projected.displayMessages, projected.contextMessages)
  assert.equal(messages[2].content, 'user-2')
  assert.equal(messages.length, 4)
})

test('canceling a revert restores the complete active context without changing the visible transcript', () => {
  const messages = [message('user-1', 'user'), message('assistant-1', 'assistant')]
  const reverted = projectHistoryCutoff(messages, 'user-1')
  const canceled = projectHistoryCutoff(messages, null)
  assert.equal(canceled.displayMessages, reverted.displayMessages)
  assert.equal(canceled.contextMessages, messages)
})
