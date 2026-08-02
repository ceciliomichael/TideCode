import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatAttachment } from '../src/types/chat'
import {
  createQueuedComposerMessage,
  dequeueQueuedComposerMessage,
  removeQueuedComposerMessage,
  requeueQueuedComposerMessage,
  reorderQueuedComposerMessages,
  updateQueuedComposerMessage,
} from '../src/pages/chatInterface/chatComposerQueue'

function createTextAttachment(id: string): ChatAttachment {
  return {
    id,
    kind: 'text',
    fileName: `${id}.txt`,
    mimeType: 'text/plain',
    sizeBytes: 12,
    textContent: id,
  }
}

test('createQueuedComposerMessage copies attachments and assigns queue metadata', () => {
  const attachments = [createTextAttachment('attachment-1')]
  const queuedMessage = createQueuedComposerMessage({
    attachments,
    content: 'Queue this message',
  })

  assert.equal(queuedMessage.content, 'Queue this message')
  assert.equal(queuedMessage.attachments?.length, 1)
  assert.equal(queuedMessage.attachments?.[0]?.id, 'attachment-1')
  assert.notEqual(queuedMessage.id.length, 0)
  assert.ok(queuedMessage.timestamp > 0)
})

test('updateQueuedComposerMessage updates one queued message without affecting the rest', () => {
  const firstMessage = createQueuedComposerMessage({ content: 'First' })
  const secondMessage = createQueuedComposerMessage({ content: 'Second' })

  const nextMessages = updateQueuedComposerMessage(
    [firstMessage, secondMessage],
    secondMessage.id,
    'Updated second',
    [createTextAttachment('attachment-2')],
  )

  assert.equal(nextMessages[0]?.content, 'First')
  assert.equal(nextMessages[1]?.content, 'Updated second')
  assert.equal(nextMessages[1]?.attachments?.[0]?.id, 'attachment-2')
})

test('removeQueuedComposerMessage deletes the matching queued message', () => {
  const firstMessage = createQueuedComposerMessage({ content: 'First' })
  const secondMessage = createQueuedComposerMessage({ content: 'Second' })

  const nextMessages = removeQueuedComposerMessage([firstMessage, secondMessage], firstMessage.id)

  assert.deepEqual(nextMessages.map((message) => message.content), ['Second'])
})

test('reorderQueuedComposerMessages moves a queued item before the drop target', () => {
  const firstMessage = createQueuedComposerMessage({ content: 'First' })
  const secondMessage = createQueuedComposerMessage({ content: 'Second' })
  const thirdMessage = createQueuedComposerMessage({ content: 'Third' })

  const nextMessages = reorderQueuedComposerMessages(
    [firstMessage, secondMessage, thirdMessage],
    thirdMessage.id,
    firstMessage.id,
  )

  assert.deepEqual(nextMessages.map((message) => message.content), ['Third', 'First', 'Second'])
})

test('reorderQueuedComposerMessages moves an earlier item after the drop target', () => {
  const firstMessage = createQueuedComposerMessage({ content: 'First' })
  const secondMessage = createQueuedComposerMessage({ content: 'Second' })
  const thirdMessage = createQueuedComposerMessage({ content: 'Third' })

  const nextMessages = reorderQueuedComposerMessages(
    [firstMessage, secondMessage, thirdMessage],
    firstMessage.id,
    secondMessage.id,
  )

  assert.deepEqual(nextMessages.map((message) => message.content), ['Second', 'First', 'Third'])
})

test('reorderQueuedComposerMessages leaves an unknown drag target unchanged', () => {
  const firstMessage = createQueuedComposerMessage({ content: 'First' })

  const nextMessages = reorderQueuedComposerMessages([firstMessage], firstMessage.id, 'missing-target')

  assert.deepEqual(nextMessages.map((message) => message.content), ['First'])
})

test('dequeueQueuedComposerMessage returns the first message and the remaining queue', () => {
  const firstMessage = createQueuedComposerMessage({ content: 'First' })
  const secondMessage = createQueuedComposerMessage({ content: 'Second' })

  const result = dequeueQueuedComposerMessage([firstMessage, secondMessage])

  assert.equal(result.nextMessage?.content, 'First')
  assert.deepEqual(result.remainingMessages.map((message) => message.content), ['Second'])
})

test('requeueQueuedComposerMessage does not duplicate a queued item during a retry race', () => {
  const queuedMessage = createQueuedComposerMessage({ content: 'Retry this once' })
  const existingMessages = [queuedMessage]

  const nextMessages = requeueQueuedComposerMessage(existingMessages, queuedMessage, 0)

  assert.deepEqual(nextMessages.map((message) => message.id), [queuedMessage.id])
})
