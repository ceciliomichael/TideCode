import test from 'node:test'
import assert from 'node:assert/strict'
import { getFollowUpKeyHint, resolveFollowUpKeyBehavior } from '../../electron/cli/terminalFollowUpKeys'

test('follow-up keys use the desktop preference as Enter and invert Tab', () => {
  assert.equal(resolveFollowUpKeyBehavior('primary', 'steer'), 'steer')
  assert.equal(resolveFollowUpKeyBehavior('alternate', 'steer'), 'queue')
  assert.equal(resolveFollowUpKeyBehavior('primary', 'queue'), 'queue')
  assert.equal(resolveFollowUpKeyBehavior('alternate', 'queue'), 'steer')
})

test('follow-up key hint reflects the active preference', () => {
  assert.equal(getFollowUpKeyHint('steer'), 'Enter steer · Tab queue · Esc stop')
  assert.equal(getFollowUpKeyHint('queue'), 'Enter queue · Tab steer · Esc stop')
})
