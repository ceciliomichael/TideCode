import assert from 'node:assert/strict'
import test from 'node:test'
import { getMaxSidebarWidthForContent } from '../src/lib/sidebarSizing'

test('sidebar resizing uses the actual available center width without taking space from the right panel', () => {
  assert.equal(getMaxSidebarWidthForContent(336, 632, 512), 448)
})

test('sidebar growth stops when the center panel reaches its minimum', () => {
  assert.equal(getMaxSidebarWidthForContent(400, 520, 512), 400)
  assert.equal(getMaxSidebarWidthForContent(400, 490, 512), 400)
})

test('sidebar growth respects the file editor center region when open', () => {
  assert.equal(getMaxSidebarWidthForContent(336, 500.75, 320), 508)
})
