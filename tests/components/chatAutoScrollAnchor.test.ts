import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveMessageAnchorScrollTop } from '../../src/components/chat/useChatAutoScroll'

test('resolveMessageAnchorScrollTop positions the reverted message near the top of the viewport', () => {
  assert.equal(
    resolveMessageAnchorScrollTop({
      clientHeight: 600,
      currentScrollTop: 1400,
      messageTop: 260,
      scrollHeight: 3000,
      viewportTop: 100,
    }),
    1536,
  )
})

test('resolveMessageAnchorScrollTop clamps to the available scroll range', () => {
  assert.equal(
    resolveMessageAnchorScrollTop({
      clientHeight: 600,
      currentScrollTop: 0,
      messageTop: 80,
      scrollHeight: 3000,
      viewportTop: 100,
    }),
    0,
  )

  assert.equal(
    resolveMessageAnchorScrollTop({
      clientHeight: 600,
      currentScrollTop: 2300,
      messageTop: 900,
      scrollHeight: 3000,
      viewportTop: 100,
    }),
    2400,
  )
})
