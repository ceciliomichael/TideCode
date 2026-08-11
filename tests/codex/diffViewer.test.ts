import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateVisibleDiffRange } from '../../src/components/chat/diffViewerVirtualization'

test('calculateVisibleDiffRange advances when the diff body scrolls itself', () => {
  const visibleRange = calculateVisibleDiffRange({
    elementTop: 0,
    lineHeight: 20,
    overscanCount: 2,
    totalLineCount: 1000,
    viewportHeight: 200,
    viewportTop: 400,
  })

  assert.equal(visibleRange.startIndex, 18)
  assert.equal(visibleRange.endIndex, 32)
})

test('calculateVisibleDiffRange clamps to valid bounds', () => {
  const visibleRange = calculateVisibleDiffRange({
    elementTop: 100,
    lineHeight: 20,
    overscanCount: 5,
    totalLineCount: 10,
    viewportHeight: 80,
    viewportTop: 0,
  })

  assert.equal(visibleRange.startIndex, 0)
  assert.equal(visibleRange.endIndex, 5)
})
