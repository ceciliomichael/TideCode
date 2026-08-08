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
