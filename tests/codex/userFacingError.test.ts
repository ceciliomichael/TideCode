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
