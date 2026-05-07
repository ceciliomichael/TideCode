import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getWorkspaceEditorAvailableWidth,
  getWorkspaceEditorScrollTransform,
  measureEditorLineWrapCount,
} from '../../../src/components/workspaceExplorer/workspaceFileEditor/workspaceFileEditorUtils'

test('workspace editor available width subtracts the horizontal padding budget', () => {
  assert.equal(getWorkspaceEditorAvailableWidth(500), 476)
})

test('workspace editor scroll transform follows the current wrapping mode', () => {
  assert.equal(getWorkspaceEditorScrollTransform(12, 24, false), 'translate(-12px, -24px)')
  assert.equal(getWorkspaceEditorScrollTransform(12, 24, true), 'translateY(-24px)')
})

test('workspace editor wrap count falls back to a single line and grows with content width', () => {
  const context = {
    measureText(text: string) {
      return { width: text.length * 10 }
    },
  } as CanvasRenderingContext2D

  assert.equal(measureEditorLineWrapCount(context, '', 80), 1)
  assert.equal(measureEditorLineWrapCount(context, 'abcdef', 20), 3)
})
