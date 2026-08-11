import assert from 'node:assert/strict'
import test from 'node:test'
import { ActiveChatStreamRegistry } from '../../electron/chat/shared/activeChatStreamRegistry'

test('cancelling a stream waits for the stream to settle', async () => {
  const registry = new ActiveChatStreamRegistry()
  const abortController = new AbortController()
  registry.register('stream-1', abortController)

  let cancellationSettled = false
  const cancellation = registry.cancel('stream-1').then((cancelled) => {
    cancellationSettled = true
    return cancelled
  })

  await Promise.resolve()
  assert.equal(abortController.signal.aborted, true)
  assert.equal(cancellationSettled, false)

  registry.settle('stream-1')
  assert.equal(await cancellation, true)
  assert.equal(await registry.cancel('stream-1'), false)
})

test('settling an unknown stream is harmless', () => {
  const registry = new ActiveChatStreamRegistry()

  assert.doesNotThrow(() => registry.settle('missing-stream'))
})

test('a stream consumes every currently pending steer message as one boundary batch', () => {
  const registry = new ActiveChatStreamRegistry()
  const abortController = new AbortController()
  const registration = registry.register('stream-1', abortController)

  assert.equal(registry.updatePendingSteerMessages('stream-1', {
    messages: [
      { content: 'first', id: 'steer-1', timestamp: 1 },
      { content: 'second', id: 'steer-2', timestamp: 2 },
    ],
    revision: 1,
  }), true)
  assert.deepEqual(
    registration.steering.consumePendingAtToolBoundary().map((message) => message.id),
    ['steer-1', 'steer-2'],
  )
  assert.deepEqual(registration.steering.consumePendingAtToolBoundary(), [])
  assert.equal(abortController.signal.aborted, false, 'steering must not cancel the active run')
})

test('consumed steer messages cannot be restored by a delayed queue snapshot', () => {
  const registry = new ActiveChatStreamRegistry()
  const registration = registry.register('stream-1', new AbortController())
  registry.updatePendingSteerMessages('stream-1', {
    messages: [{ content: 'first', id: 'steer-1', timestamp: 1 }],
    revision: 1,
  })
  registration.steering.consumePendingAtToolBoundary()

  registry.updatePendingSteerMessages('stream-1', {
    messages: [
      { content: 'first', id: 'steer-1', timestamp: 1 },
      { content: 'next boundary', id: 'steer-2', timestamp: 2 },
    ],
    revision: 2,
  })

  assert.deepEqual(
    registration.steering.consumePendingAtToolBoundary().map((message) => message.id),
    ['steer-2'],
  )
})
