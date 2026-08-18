import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampRenderedCodeContentHeight,
  MIN_CODE_BLOCK_HEIGHT_PX,
  resolveInitialCodeContentHeight,
} from '../src/components/chat/workspaceMonacoCodeSizing'

test('code block sizing expands a one-line source to its rendered wrapped height', () => {
  assert.equal(resolveInitialCodeContentHeight('one source line'), MIN_CODE_BLOCK_HEIGHT_PX)
  assert.equal(clampRenderedCodeContentHeight(56, null), 56)
})

test('code block sizing keeps a one-line minimum and respects the tool-result cap', () => {
  assert.equal(clampRenderedCodeContentHeight(10, null), MIN_CODE_BLOCK_HEIGHT_PX)
  assert.equal(clampRenderedCodeContentHeight(480, 320), 320)
})
