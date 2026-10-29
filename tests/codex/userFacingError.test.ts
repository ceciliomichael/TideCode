import assert from 'node:assert/strict'
import test from 'node:test'
import { toUserFacingErrorMessage } from '../../src/lib/userFacingError'
import { CompactionError } from '../../electron/chat/shared/compaction/gate'
import { errorCatalog } from '../../src/lib/errors/errorCatalog'

test('specific compaction errors survive transport wrappers as actionable messages', () => {
  const error = new CompactionError('commit_failed')
  const transported = new Error(`Error invoking remote method 'chat:start': ${error.message}`)
  assert.equal(toUserFacingErrorMessage(transported, 'Fallback'), errorCatalog['compaction.commit_failed'].message)
  assert.notEqual(toUserFacingErrorMessage(error, 'Fallback'), 'Fallback')
})

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

test('unrecognized technical errors never become application copy', () => {
  const fallback = 'The action could not be completed. Try again.'
  for (const error of [
    'SyntaxError: Unexpected token } in JSON at position 21',
    'TypeError: Cannot read properties of undefined',
    'ERR_UNKNOWN_INTERNAL_STATE at renderer.ts:150',
    'C:\\Users\\someone\\project\\node_modules\\module.js:45',
    'Error invoking remote method "foo:bar": RpcError',
  ]) {
    assert.equal(toUserFacingErrorMessage(error, fallback), fallback)
  }
})

test('webpage and capacity errors have nontechnical recovery instructions', () => {
  assert.equal(
    toUserFacingErrorMessage('net::ERR_NAME_NOT_RESOLVED', 'Fallback'),
    'This website could not be found. Check its address and try again.',
  )
  assert.equal(
    toUserFacingErrorMessage('ENOSPC: no space left on device', 'Fallback'),
    'There is not enough disk space to complete this action. Free some space and try again.',
  )
  assert.equal(
    toUserFacingErrorMessage('net::ERR_CONNECTION_REFUSED', 'Fallback'),
    'The website could not be reached. Check its address and your connection, then try again.',
  )
})

test('short actionable validation messages retain their meaning', () => {
  assert.equal(toUserFacingErrorMessage('Folder name is required.', 'Fallback'), 'Folder name is required.')
})
