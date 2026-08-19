import assert from 'node:assert/strict'
import test from 'node:test'
import {
  findChatMentionForDeletion,
  getChatMentionTriggerState,
  resolveChatMentionNativeDeletionChange,
  shouldCloseChatMentionMenuForNormalText,
} from '../src/lib/chatMentions'

test('selected mentions are atomic deletion targets for mobile and desktop input events', () => {
  const value = 'see @main.ts please'
  const knownMentions = new Map([['main.ts', 'read_file:src/main.ts']])

  assert.deepEqual(
    findChatMentionForDeletion({
      direction: 'backward',
      knownMentionLabels: knownMentions,
      selectionEnd: 12,
      selectionStart: 12,
      text: value,
    }),
    { end: 12, label: 'main.ts', path: 'read_file:src/main.ts', start: 4 },
  )
  assert.deepEqual(
    findChatMentionForDeletion({
      direction: 'backward',
      knownMentionLabels: knownMentions,
      selectionEnd: 8,
      selectionStart: 8,
      text: value,
    }),
    { end: 12, label: 'main.ts', path: 'read_file:src/main.ts', start: 4 },
  )
  assert.deepEqual(
    findChatMentionForDeletion({
      direction: 'forward',
      knownMentionLabels: knownMentions,
      selectionEnd: 4,
      selectionStart: 4,
      text: value,
    }),
    { end: 12, label: 'main.ts', path: 'read_file:src/main.ts', start: 4 },
  )
  assert.equal(
    findChatMentionForDeletion({
      direction: 'backward',
      knownMentionLabels: knownMentions,
      selectionEnd: 12,
      selectionStart: 4,
      text: value,
    }),
    null,
  )
})

test('mobile native deletion repairs a partially deleted mention into an atomic deletion', () => {
  const knownMentions = new Map([['main.ts', 'read_file:src/main.ts']])

  assert.deepEqual(
    resolveChatMentionNativeDeletionChange({
      knownMentionLabels: knownMentions,
      nextText: 'see @main.t please',
      previousText: 'see @main.ts please',
    }),
    {
      nextCursorPosition: 4,
      nextValue: 'see  please',
    },
  )

  assert.deepEqual(
    resolveChatMentionNativeDeletionChange({
      knownMentionLabels: knownMentions,
      nextText: 'see @mai.ts please',
      previousText: 'see @main.ts please',
    }),
    {
      nextCursorPosition: 4,
      nextValue: 'see  please',
    },
  )

  assert.equal(
    resolveChatMentionNativeDeletionChange({
      knownMentionLabels: knownMentions,
      nextText: 'see @main.tsplease',
      previousText: 'see @main.ts please',
    }),
    null,
  )
})

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
