import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWorkspaceEditorLineStatusMap } from '../../../src/components/workspaceExplorer/workspaceFileEditor/workspaceEditorGitStatus'

test('workspace editor Git status distinguishes added and replaced lines', () => {
  assert.deepEqual(
    Array.from(buildWorkspaceEditorLineStatusMap('alpha\nbeta\ngamma', 'alpha\nchanged\ngamma\nextra')),
    [
      [2, 'changed'],
      [4, 'added'],
    ],
  )
})

test('workspace editor Git status marks every line in a newly created file', () => {
  assert.deepEqual(
    Array.from(buildWorkspaceEditorLineStatusMap('', 'alpha\nbeta')),
    [
      [1, 'added'],
      [2, 'added'],
    ],
  )
})
