import assert from 'node:assert/strict'
import test from 'node:test'
import { toUserFacingErrorMessage } from '../../src/lib/userFacingError'

test('technical chat failures are replaced with actionable copy', () => {
  assert.equal(
    toUserFacingErrorMessage(
      new Error("Error invoking remote method 'chat:start': AI_NoOutputGeneratedError"),
      'Unable to get a response right now.',
    ),
    'Unable to get a response right now.',
  )
  assert.equal(
    toUserFacingErrorMessage(new Error('TypeError: fetch failed'), 'Fallback'),
    'The provider could not be reached. Check your connection and try again.',
  )
})

test('context limit failures explain the manual recovery path', () => {
  assert.equal(
    toUserFacingErrorMessage(new Error('context_length_exceeded'), 'Fallback'),
    'This chat is too large for the selected model. Compress it manually or start a new chat.',
  )
})

test('git partial-success failures preserve that the commit succeeded', () => {
  assert.equal(
    toUserFacingErrorMessage(
      new Error(
        "Error invoking remote method 'git:commit': Error: Committed successfully but failed to push: branch could not be published",
      ),
      'The changes could not be committed.',
    ),
    'The commit succeeded, but the push or pull request step failed. Your commit is still saved locally.',
  )
})

test('workspace duplicate errors explain what the user should do', () => {
  assert.equal(
    toUserFacingErrorMessage(
      new Error("Error invoking remote method 'workspace:explorer:createEntry': Error: Entry already exists: public"),
      'The folder could not be created.',
      { itemKind: 'folder' },
    ),
    'A folder named “public” already exists. Choose a different name.',
  )
})

test('workspace filesystem failures do not expose operating-system error codes', () => {
  assert.equal(
    toUserFacingErrorMessage(new Error("Error: EACCES: permission denied, mkdir 'private'"), 'Fallback'),
    'TideCode does not have permission to change that item. Check the folder permissions and try again.',
  )
  assert.equal(
    toUserFacingErrorMessage(new Error('Error: ENOENT: no such file or directory'), 'Fallback'),
    'That workspace item is no longer available. Refresh the explorer and try again.',
  )
})
