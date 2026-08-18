import assert from 'node:assert/strict'
import test from 'node:test'
import { SharedFollowUpStore } from '../../electron/runService/followUpStore'

test('shared follow-up store owns revision and preserves cross-surface order', () => {
  const store = new SharedFollowUpStore()
  store.register('run-1', 'stream-1', 'conversation-1')

  const afterSteer = store.update('stream-1', {
    type: 'add',
    item: { behavior: 'steer', message: { content: 'steer first', id: 'steer-1', timestamp: 1 } },
  })
  const afterQueue = store.update('stream-1', {
    type: 'add',
    item: { behavior: 'queue', message: { content: 'queue second', id: 'queue-1', timestamp: 2 } },
  })

  assert.equal(afterSteer.revision, 1)
  assert.equal(afterQueue.revision, 2)
  assert.deepEqual(afterQueue.items.map((item) => [item.behavior, item.message.content]), [
    ['steer', 'steer first'],
    ['queue', 'queue second'],
  ])
})

test('shared follow-up store removes consumed steers and atomically claims the remainder', () => {
  const store = new SharedFollowUpStore()
  store.register('run-1', 'stream-1', 'conversation-1')
  store.update('stream-1', {
    type: 'add',
    item: { behavior: 'steer', message: { content: 'use now', id: 'steer-1', timestamp: 1 } },
  })
  store.update('stream-1', {
    type: 'add',
    item: { behavior: 'queue', message: { content: 'use next', id: 'queue-1', timestamp: 2 } },
  })

  const afterConsume = store.consume('stream-1', ['steer-1'])
  assert.deepEqual(afterConsume?.items.map((item) => item.message.content), ['use next'])
  assert.deepEqual(store.claim('stream-1').messages.map((message) => message.content), ['use next'])
  assert.deepEqual(store.claim('stream-1').messages, [])
})
