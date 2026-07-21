import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkspaceExplorerWatchSubscriptions } from '../../electron/workspace/explorerWatchSubscriptions'

test('keeps a subscriber attached until every consumer releases the workspace', () => {
  const subscriptions = new WorkspaceExplorerWatchSubscriptions()

  assert.equal(subscriptions.subscribe(7, 'C:\\workspace'), true)
  assert.equal(subscriptions.subscribe(7, 'C:\\workspace'), false)
  assert.equal(subscriptions.unsubscribe(7, 'C:\\workspace'), false)
  assert.equal(subscriptions.unsubscribe(7, 'C:\\workspace'), true)
  assert.equal(subscriptions.unsubscribe(7, 'C:\\workspace'), false)
})

test('tracks workspace subscriptions independently for the same window', () => {
  const subscriptions = new WorkspaceExplorerWatchSubscriptions()

  assert.equal(subscriptions.subscribe(11, 'C:\\workspace-a'), true)
  assert.equal(subscriptions.subscribe(11, 'C:\\workspace-b'), true)
  assert.equal(subscriptions.unsubscribe(11, 'C:\\workspace-a'), true)
  assert.deepEqual(subscriptions.removeSubscriber(11), ['C:\\workspace-b'])
})

test('window cleanup returns each subscribed root once regardless of reference count', () => {
  const subscriptions = new WorkspaceExplorerWatchSubscriptions()

  subscriptions.subscribe(23, 'C:\\workspace-a')
  subscriptions.subscribe(23, 'C:\\workspace-a')
  subscriptions.subscribe(23, 'C:\\workspace-b')

  assert.deepEqual(
    subscriptions.removeSubscriber(23).sort(),
    ['C:\\workspace-a', 'C:\\workspace-b'],
  )
  assert.deepEqual(subscriptions.removeSubscriber(23), [])
})
