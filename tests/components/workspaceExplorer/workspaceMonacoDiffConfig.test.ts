import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampWorkspaceMonacoDiffHeight,
  createWorkspaceMonacoDiffOptions,
  createWorkspaceMonacoViewOptions,
  resolveWorkspaceMonacoDiffMaxHeight,
} from '../../../src/components/chat/diffViewer/workspaceMonacoDiffConfig'

test('Monaco diff uses VS Code wrapping and responsive side-by-side behavior', () => {
  const options = createWorkspaceMonacoDiffOptions({
    contextLines: 5,
    isStreaming: false,
    startLineNumber: 40,
  })

  assert.equal(options.diffAlgorithm, 'advanced')
  assert.equal(options.diffWordWrap, 'on')
  assert.equal(options.wordWrap, 'on')
  assert.equal(options.wrappingIndent, 'same')
  assert.equal(options.renderSideBySide, true)
  assert.equal(options.useInlineViewWhenSpaceIsLimited, true)
  assert.equal(options.lineDecorationsWidth, 14)
  assert.equal(options.lineNumbersMinChars, 5)
  assert.equal(options.renderIndicators, false)
  assert.equal(options.folding, false)
  assert.equal(options.showFoldingControls, 'never')
  assert.deepEqual(options.padding, { bottom: 0, top: 0 })
  assert.equal(options.hideUnchangedRegions?.contextLineCount, 5)
  assert.equal(typeof options.lineNumbers === 'function' ? options.lineNumbers(1) : '', '40')
})

test('Monaco diff clamps embedded height and allows expanded panels to grow', () => {
  assert.equal(resolveWorkspaceMonacoDiffMaxHeight('max-h-80'), 320)
  assert.equal(resolveWorkspaceMonacoDiffMaxHeight(undefined), null)
  assert.equal(clampWorkspaceMonacoDiffHeight(500, 320), 320)
  assert.equal(clampWorkspaceMonacoDiffHeight(500, null), 500)
  assert.equal(clampWorkspaceMonacoDiffHeight(20, null), 20)
  assert.deepEqual(createWorkspaceMonacoViewOptions(1).padding, { bottom: 0, top: 0 })
})
