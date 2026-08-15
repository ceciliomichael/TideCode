import assert from 'node:assert/strict'
import test from 'node:test'
import { isSkippableWorkspaceTraversalError } from '../../electron/workspace/workspaceTraversal'

test('treats permission and disappearing-entry errors as skippable traversal failures', () => {
  for (const code of ['EACCES', 'EISDIR', 'ENOENT', 'ENOTDIR', 'EPERM']) {
    assert.equal(isSkippableWorkspaceTraversalError({ code }), true, code)
  }
})

test('does not hide unexpected traversal failures', () => {
  assert.equal(isSkippableWorkspaceTraversalError({ code: 'EIO' }), false)
  assert.equal(isSkippableWorkspaceTraversalError(new Error('permission denied')), false)
})
