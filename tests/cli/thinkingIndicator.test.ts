import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getThinkingSpinnerFrame,
  THINKING_SPINNER_FRAMES,
} from '../../electron/cli/thinkingIndicator'

test('thinking spinner cycles through the shared indicator frames', () => {
  assert.equal(getThinkingSpinnerFrame(0), '⠋')
  assert.equal(getThinkingSpinnerFrame(1), '⠙')
  assert.equal(getThinkingSpinnerFrame(THINKING_SPINNER_FRAMES.length), '⠋')
  assert.equal(getThinkingSpinnerFrame(-1), '⠏')
})
