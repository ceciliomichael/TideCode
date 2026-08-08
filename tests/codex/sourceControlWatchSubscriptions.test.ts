import assert from 'node:assert/strict'
import test from 'node:test'
import { SourceControlWatchSubscriptions } from '../../electron/git/sourceControlWatchSubscriptions'

test('keeps a source-control watcher subscription until every consumer releases it', () => {
  const subscriptions = new SourceControlWatchSubscriptions()

  assert.equal(subscriptions.subscribe(7, 'C:\\workspace'), true)
  assert.equal(subscriptions.subscribe(7, 'C:\\workspace'), false)
  assert.equal(subscriptions.unsubscribe(7, 'C:\\workspace'), false)
  assert.equal(subscriptions.unsubscribe(7, 'C:\\workspace'), true)
  assert.equal(subscriptions.unsubscribe(7, 'C:\\workspace'), false)
})

test('cleans up every workspace when a renderer sender is destroyed', () => {
  const subscriptions = new SourceControlWatchSubscriptions()

  subscriptions.subscribe(11, 'C:\\workspace-a')
  subscriptions.subscribe(11, 'C:\\workspace-a')
  subscriptions.subscribe(11, 'C:\\workspace-b')

  assert.deepEqual(
    subscriptions.removeSubscriber(11).sort(),
    ['C:\\workspace-a', 'C:\\workspace-b'],
  )
  assert.deepEqual(subscriptions.removeSubscriber(11), [])
})
