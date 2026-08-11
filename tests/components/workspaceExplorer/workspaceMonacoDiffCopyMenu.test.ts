import assert from 'node:assert/strict'
import test from 'node:test'
import type { editor } from 'monaco-editor'
import {
  getWorkspaceMonacoDiffOriginalLineCount,
  resolveWorkspaceMonacoDiffCopyMenuPosition,
} from '../../../src/components/chat/diffViewer/workspaceMonacoDiffCopy'

test('diff copy menu remains inside the viewport at every edge', () => {
  assert.deepEqual(
    resolveWorkspaceMonacoDiffCopyMenuPosition(
      { x: 790, y: 590 },
      { height: 600, width: 800 },
      { height: 80, width: 220 },
    ),
    { left: 572, top: 512 },
  )
  assert.deepEqual(
    resolveWorkspaceMonacoDiffCopyMenuPosition(
      { x: -20, y: -10 },
      { height: 600, width: 800 },
      { height: 80, width: 220 },
    ),
    { left: 8, top: 8 },
  )
})

test('diff copy menu derives inclusive original line counts', () => {
  const change = {
    originalStartLineNumber: 7,
    originalEndLineNumber: 10,
    modifiedStartLineNumber: 7,
    modifiedEndLineNumber: 8,
    charChanges: undefined,
  } satisfies editor.ILineChange

  assert.equal(getWorkspaceMonacoDiffOriginalLineCount(change), 4)
})
