import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSelectionRangesByLine,
  getWorkspaceEditorAvailableWidth,
  getWorkspaceEditorScrollTransform,
  measureEditorLineWrapCount,
  normalizeTextSelectionRange,
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

test('workspace editor clears a collapsed selection after replacement typing', () => {
  assert.equal(normalizeTextSelectionRange(4, 4, 12), null)
})

test('workspace editor clamps selection offsets to the current value', () => {
  assert.deepEqual(normalizeTextSelectionRange(20, -4, 12), {
    end: 12,
    start: 0,
  })
})

test('workspace editor maps multi-line selections without shifting empty lines', () => {
  assert.deepEqual(buildSelectionRangesByLine('alpha\n\nomega', { start: 2, end: 8 }), [
    [
      {
        end: 5,
        isActive: true,
        isNewlineSelected: true,
        start: 2,
      },
    ],
    [
      {
        end: 0,
        isActive: true,
        isNewlineSelected: true,
        start: 0,
      },
    ],
    [
      {
        end: 1,
        isActive: true,
        isNewlineSelected: false,
        start: 0,
      },
    ],
  ])
})
