import assert from 'node:assert/strict'
import test from 'node:test'
import { rollbackOptimisticUserMessages } from '../src/hooks/chatOptimisticSendPresentation'
import type { Message } from '../src/types/chat'

const original: Message = { id: 'user', role: 'user', content: 'Original', timestamp: 1 }
const reply: Message = { id: 'reply', role: 'assistant', content: 'Reply', timestamp: 2 }
const pending: Message = { ...original, content: 'Edited' }
const incoming: Message = { id: 'incoming', role: 'assistant', content: 'Incoming', timestamp: 3 }

test('a failed edit restores its original branch without dropping incoming messages', () => {
  assert.deepEqual(
    rollbackOptimisticUserMessages([pending, incoming], [original, reply], [pending], original.id),
    [original, reply, incoming],
  )
})

test('a failed older edit cannot overwrite a newer revision of the same message', () => {
  const newer = { ...pending, content: 'Newer edit' }
  assert.deepEqual(
    rollbackOptimisticUserMessages([newer], [original, reply], [pending], original.id),
    [newer],
  )
})

test('a failed batch removes only its submitted IDs', () => {
  const second = { ...pending, id: 'second' }
  assert.deepEqual(rollbackOptimisticUserMessages([pending, second, incoming], [], [pending, second], null), [incoming])
})
