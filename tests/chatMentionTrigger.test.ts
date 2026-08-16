import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getChatMentionTriggerState,
  shouldCloseChatMentionMenuForNormalText,
} from '../src/lib/chatMentions'

test('an unselected mention becomes normal text after a space', () => {
  const value = '@not-a-real-file '
  const knownMentions = new Map([['main.ts', 'read_file:src/main.ts']])
  const triggerState = getChatMentionTriggerState(value, value.length, knownMentions)

  assert.deepEqual(triggerState, {
    query: 'not-a-real-file ',
    start: 0,
  })
  assert.equal(shouldCloseChatMentionMenuForNormalText(triggerState), true)
  const unspacedValue = '@not-a-real-file'
  assert.equal(
    shouldCloseChatMentionMenuForNormalText(
      getChatMentionTriggerState(unspacedValue, unspacedValue.length, knownMentions),
    ),
    false,
  )
})
