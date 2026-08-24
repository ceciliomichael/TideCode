import assert from 'node:assert/strict'
import test from 'node:test'
import {
  didScrollableRangeShrink,
  getScrollContainerMetrics,
  getScrollContainerSnapshot,
  isNearScrollBottom,
  isScrollingDown,
  isScrollingUp,
  resolveScrollFollowing,
  shouldMeasureScrollContainerLayout,
} from '../src/components/chat/scrollFollowPolicy'

function createScrollContainer(scrollTop: number) {
  return {
    clientHeight: 400,
    scrollHeight: 1_000,
    scrollTop,
  }
}

function createSnapshot(scrollTop: number, scrollHeight = 1_000, clientHeight = 400) {
  return getScrollContainerSnapshot({ clientHeight, scrollHeight, scrollTop })
}

test('scroll metrics clamp the bottom position and distance to zero', () => {
  assert.deepEqual(getScrollContainerMetrics(createScrollContainer(700)), {
    distanceFromBottom: 0,
    maxScrollTop: 600,
  })
})

test('near-bottom detection allows a small streaming layout gap', () => {
  assert.equal(isNearScrollBottom(createScrollContainer(560)), true)
  assert.equal(isNearScrollBottom(createScrollContainer(551)), false)
})

test('upward movement is recognized before the viewport leaves the near-bottom band', () => {
  assert.equal(isScrollingUp(600, 599), false)
  assert.equal(isScrollingUp(600, 598), true)
})

test('downward movement is recognized when returning toward the latest message', () => {
  assert.equal(isScrollingDown(598, 599), false)
  assert.equal(isScrollingDown(598, 600), true)
})

test('paused upward scrolling can skip expensive layout measurements', () => {
  assert.equal(shouldMeasureScrollContainerLayout(false, 600, 560), false)
  assert.equal(shouldMeasureScrollContainerLayout(false, 560, 560), false)
  assert.equal(shouldMeasureScrollContainerLayout(false, 560, 560.25), true)
  assert.equal(shouldMeasureScrollContainerLayout(false, 560, 600), true)
  assert.equal(shouldMeasureScrollContainerLayout(true, 600, 560), true)
})

test('content growth without viewport movement preserves following', () => {
  assert.equal(
    resolveScrollFollowing({
      current: createSnapshot(600, 1_100),
      isFollowingLatest: true,
      previous: createSnapshot(600),
    }),
    true,
  )
})

test('a collapsing block is identified by its shrinking scrollable range', () => {
  assert.equal(didScrollableRangeShrink(createSnapshot(600), createSnapshot(400, 800)), true)
})

test('a layout-driven upward clamp preserves following after a block collapses', () => {
  assert.equal(
    resolveScrollFollowing({
      current: createSnapshot(400, 800),
      isFollowingLatest: true,
      previous: createSnapshot(600),
    }),
    true,
  )
})

test('a layout-driven clamp does not resume a follower that was already paused', () => {
  assert.equal(
    resolveScrollFollowing({
      current: createSnapshot(400, 800),
      isFollowingLatest: false,
      previous: createSnapshot(500),
    }),
    false,
  )
})

test('manual upward scrolling pauses following even while near the bottom', () => {
  assert.equal(
    resolveScrollFollowing({
      current: createSnapshot(590),
      isFollowingLatest: true,
      previous: createSnapshot(600),
    }),
    false,
  )
})

test('streaming layout changes cannot resume a manually paused follower', () => {
  assert.equal(
    resolveScrollFollowing({
      current: createSnapshot(590, 1_010),
      isFollowingLatest: false,
      previous: createSnapshot(590),
    }),
    false,
  )
})

test('a paused follower only resumes after reaching the actual bottom', () => {
  assert.equal(
    resolveScrollFollowing({
      current: createSnapshot(560),
      isFollowingLatest: false,
      previous: createSnapshot(520),
    }),
    true,
  )
  assert.equal(
    resolveScrollFollowing({
      current: createSnapshot(550),
      isFollowingLatest: false,
      previous: createSnapshot(520),
    }),
    false,
  )
})
