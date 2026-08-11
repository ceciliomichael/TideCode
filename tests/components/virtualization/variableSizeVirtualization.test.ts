import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateVariableSizeVirtualRange,
  DEFAULT_INITIAL_VIRTUAL_VIEWPORT_HEIGHT_PX,
  resolveVirtualViewportHeight,
} from '../../../src/components/virtualization/variableSizeVirtualization'

function createFixedSizeLayout(itemCount: number, itemHeight: number) {
  return {
    itemHeights: Array.from({ length: itemCount }, () => itemHeight),
    offsets: Array.from({ length: itemCount }, (_, index) => index * itemHeight),
  }
}

test('virtual lists use a bounded viewport before DOM measurement is available', () => {
  const layout = createFixedSizeLayout(1_000, 50)
  const viewportHeight = resolveVirtualViewportHeight(0)
  const range = calculateVariableSizeVirtualRange({
    ...layout,
    overscanPx: 320,
    scrollTop: 0,
    viewportHeight,
  })

  assert.equal(viewportHeight, DEFAULT_INITIAL_VIRTUAL_VIEWPORT_HEIGHT_PX)
  assert.equal(range.startIndex, 0)
  assert.equal(range.endIndex, 21)
  assert.ok(range.endIndex < layout.itemHeights.length)
})

test('virtual lists retain the measured viewport once it becomes available', () => {
  const layout = createFixedSizeLayout(100, 50)
  const range = calculateVariableSizeVirtualRange({
    ...layout,
    overscanPx: 100,
    scrollTop: 2_000,
    viewportHeight: resolveVirtualViewportHeight(500),
  })

  assert.deepEqual(range, {
    endIndex: 52,
    startIndex: 37,
  })
})
