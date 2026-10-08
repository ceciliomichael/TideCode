import assert from 'node:assert/strict'
import test from 'node:test'
import { createContextUsageRefresh } from '../src/hooks/useChatContextUsage'

test('context estimation runs one request at a time and coalesces a burst to the newest request', async () => {
  const queue = createContextUsageRefresh()
  const calls: number[] = []
  let finish!: () => void
  queue.request(async () => {
    calls.push(1)
    await new Promise<void>((resolve) => { finish = resolve })
  })
  queue.request(async () => { calls.push(2) })
  queue.request(async () => { calls.push(3) })
  assert.deepEqual(calls, [1])
  finish()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, [1, 3])
})

test('context estimation cleanup drops a queued refresh', async () => {
  const queue = createContextUsageRefresh()
  let finish!: () => void
  let called = false
  queue.request(() => new Promise<void>((resolve) => { finish = resolve }))
  queue.request(async () => { called = true })
  queue.cancelPending()
  finish()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(called, false)
})
