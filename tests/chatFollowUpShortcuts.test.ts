import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveFollowUpBehaviorForAction } from '../src/lib/appSettings'
import { resolveChatFollowUpShortcutAction } from '../src/lib/chatFollowUpShortcuts'

function shortcut(overrides: Partial<{ altKey: boolean; ctrlKey: boolean; key: string; metaKey: boolean; shiftKey: boolean }> = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    key: 'Enter',
    metaKey: false,
    shiftKey: false,
    ...overrides,
  }
}

test('desktop active follow-up shortcuts map Enter to primary and Ctrl/Cmd+Enter to alternate', () => {
  assert.equal(resolveChatFollowUpShortcutAction(shortcut()), 'primary')
  assert.equal(resolveChatFollowUpShortcutAction(shortcut({ ctrlKey: true })), 'alternate')
  assert.equal(resolveChatFollowUpShortcutAction(shortcut({ metaKey: true })), 'alternate')
})

test('desktop active follow-up shortcuts preserve newline and unrelated modified Enter input', () => {
  assert.equal(resolveChatFollowUpShortcutAction(shortcut({ shiftKey: true })), null)
  assert.equal(resolveChatFollowUpShortcutAction(shortcut({ altKey: true })), null)
  assert.equal(resolveChatFollowUpShortcutAction(shortcut({ key: 'a' })), null)
})

test('primary and alternate follow-up actions invert queue and steer according to settings', () => {
  assert.equal(resolveFollowUpBehaviorForAction('primary', 'steer'), 'steer')
  assert.equal(resolveFollowUpBehaviorForAction('alternate', 'steer'), 'queue')
  assert.equal(resolveFollowUpBehaviorForAction('primary', 'queue'), 'queue')
  assert.equal(resolveFollowUpBehaviorForAction('alternate', 'queue'), 'steer')
})
