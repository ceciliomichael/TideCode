import assert from 'node:assert/strict'
import test from 'node:test'
import { createSingleFlightTask } from '../src/lib/singleFlightTask'

test('single-flight tasks share one operation across concurrent subscribers', async () => {
  let invocationCount = 0
  let resolveOperation: ((value: string) => void) | null = null
  const task = createSingleFlightTask(() => {
    invocationCount += 1
    return new Promise<string>((resolve) => {
      resolveOperation = resolve
    })
  })

  const firstSubscriber = task.run()
  const secondSubscriber = task.run()

  assert.equal(firstSubscriber, secondSubscriber)
  assert.equal(invocationCount, 0)

  await Promise.resolve()
  assert.equal(invocationCount, 1)
  assert.ok(resolveOperation)
  resolveOperation('loaded')

  assert.equal(await firstSubscriber, 'loaded')
  assert.equal(await secondSubscriber, 'loaded')
  assert.equal(await task.run(), 'loaded')
  assert.equal(invocationCount, 1)
})

test('single-flight tasks preserve one rejection without restarting side effects', async () => {
  let invocationCount = 0
  const expectedError = new Error('history unavailable')
  const task = createSingleFlightTask(async () => {
    invocationCount += 1
    throw expectedError
  })

  const firstSubscriber = task.run()
  const secondSubscriber = task.run()

  await assert.rejects(firstSubscriber, expectedError)
  await assert.rejects(secondSubscriber, expectedError)
  await assert.rejects(task.run(), expectedError)
  assert.equal(invocationCount, 1)
})
