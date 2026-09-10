import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampRenderedCodeContentHeight,
  CODE_LINE_HEIGHT_PX,
  CODE_VERTICAL_PADDING_PX,
  MIN_CODE_BLOCK_HEIGHT_PX,
  resolveInitialCodeContentHeight,
  resolveWorkspaceMonacoCodeMaxHeight,
  TOOL_RESULT_CODE_MAX_HEIGHT_PX,
} from '../src/components/chat/workspaceMonacoCodeSizing'

test('code block sizing derives the initial height from visible source lines', () => {
  assert.equal(resolveInitialCodeContentHeight(''), MIN_CODE_BLOCK_HEIGHT_PX)
  assert.equal(resolveInitialCodeContentHeight('one source line'), MIN_CODE_BLOCK_HEIGHT_PX)
  assert.equal(resolveInitialCodeContentHeight('one\ntwo'), CODE_LINE_HEIGHT_PX * 2 + CODE_VERTICAL_PADDING_PX * 2)
  assert.equal(resolveInitialCodeContentHeight('one\ntwo\nthree'), CODE_LINE_HEIGHT_PX * 3 + CODE_VERTICAL_PADDING_PX * 2)
  assert.equal(clampRenderedCodeContentHeight(56, null), 56)
})

test('code block sizing keeps a one-line minimum and respects the tool-result cap', () => {
  assert.equal(clampRenderedCodeContentHeight(10, null), MIN_CODE_BLOCK_HEIGHT_PX)
  assert.equal(resolveWorkspaceMonacoCodeMaxHeight(undefined), null)
  assert.equal(resolveWorkspaceMonacoCodeMaxHeight('max-h-80'), TOOL_RESULT_CODE_MAX_HEIGHT_PX)
  assert.equal(resolveWorkspaceMonacoCodeMaxHeight('max-h-64'), null)
  assert.equal(clampRenderedCodeContentHeight(480, TOOL_RESULT_CODE_MAX_HEIGHT_PX), TOOL_RESULT_CODE_MAX_HEIGHT_PX)
  assert.equal(
    resolveInitialCodeContentHeight(Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n'), TOOL_RESULT_CODE_MAX_HEIGHT_PX),
    TOOL_RESULT_CODE_MAX_HEIGHT_PX,
  )
})
