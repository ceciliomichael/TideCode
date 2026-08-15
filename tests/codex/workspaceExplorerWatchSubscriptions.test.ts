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

test('preserves expanded Explorer paths when another consumer subscribes to the same workspace', () => {
  const subscriptions = new WorkspaceExplorerWatchSubscriptions()

  subscriptions.subscribe(8, 'C:\\workspace', new Set(['.', 'src', 'src/components']))
  subscriptions.subscribe(8, 'C:\\workspace', new Set(['.']))

  assert.deepEqual(
    Array.from(subscriptions.getWatchPaths('C:\\workspace')).sort(),
    ['.', 'src', 'src/components'],
  )
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

test('unions watched directories across subscribers and updates one subscriber safely', () => {
  const subscriptions = new WorkspaceExplorerWatchSubscriptions()

  subscriptions.subscribe(31, 'C:\\workspace', new Set(['.', 'src']))
  subscriptions.subscribe(32, 'C:\\workspace', new Set(['.', 'packages']))

  assert.deepEqual(
    Array.from(subscriptions.getWatchPaths('C:\\workspace')).sort(),
    ['.', 'packages', 'src'],
  )
  assert.equal(subscriptions.updateWatchPaths(31, 'C:\\workspace', new Set(['.', 'tests'])), true)
  assert.deepEqual(
    Array.from(subscriptions.getWatchPaths('C:\\workspace')).sort(),
    ['.', 'packages', 'tests'],
  )
  assert.equal(subscriptions.updateWatchPaths(99, 'C:\\workspace', new Set(['.'])), false)
})
