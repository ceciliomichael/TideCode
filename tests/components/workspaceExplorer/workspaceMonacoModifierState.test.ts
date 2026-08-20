import assert from 'node:assert/strict'
import test from 'node:test'
import {
  latchWorkspaceMonacoModifierPressed,
  readWorkspaceMonacoModifierPressed,
} from '../../../src/components/workspaceExplorer/workspaceFileEditor/workspaceMonacoModifierState'

test('mousemove modifier state latches true until an explicit key release clears it', () => {
  assert.equal(latchWorkspaceMonacoModifierPressed(false, { ctrlKey: true, metaKey: false }), true)
  assert.equal(latchWorkspaceMonacoModifierPressed(true, { ctrlKey: false, metaKey: false }), true)
  assert.equal(latchWorkspaceMonacoModifierPressed(false, { ctrlKey: false, metaKey: true }), true)
})

test('explicit modifier state reflects Ctrl or Meta release immediately', () => {
  assert.equal(readWorkspaceMonacoModifierPressed({ ctrlKey: true, metaKey: false }), true)
  assert.equal(readWorkspaceMonacoModifierPressed({ ctrlKey: false, metaKey: true }), true)
  assert.equal(readWorkspaceMonacoModifierPressed({ ctrlKey: false, metaKey: false }), false)
})
