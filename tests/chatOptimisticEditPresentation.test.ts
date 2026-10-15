import assert from 'node:assert/strict'
import test from 'node:test'
import { applyOptimisticEditedMessagePresentation } from '../src/hooks/chatOptimisticEditPresentation'
import type { Message } from '../src/types/chat'

function message(id: string, role: Message['role'], content = id): Message {
  return { content, id, role, timestamp: 1 }
}

test('optimistic edited presentation replaces the edited bubble and removes the later branch atomically', () => {
  const messages = [
    message('user-1', 'user'),
    message('assistant-1', 'assistant'),
    message('user-2', 'user', 'old text'),
    message('assistant-2', 'assistant'),
  ]

  const nextMessages = applyOptimisticEditedMessagePresentation(messages, {
    attachments: [],
    content: 'edited text',
    messageId: 'user-2',
  })

  assert.deepEqual(nextMessages.map((entry) => entry.id), ['user-1', 'assistant-1', 'user-2'])
  assert.equal(nextMessages[2]?.content, 'edited text')
})

test('optimistic edited presentation is non-destructive when cleared or missing', () => {
  const messages = [message('user-1', 'user'), message('assistant-1', 'assistant')]
  assert.equal(applyOptimisticEditedMessagePresentation(messages, null), messages)
  assert.equal(
    applyOptimisticEditedMessagePresentation(messages, {
      attachments: [],
      content: 'edited',
      messageId: 'missing',
    }),
    messages,
  )
})
