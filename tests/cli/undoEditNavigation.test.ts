import test from 'node:test'
import assert from 'node:assert/strict'
import type { Message } from '../../src/types/chat'
import {
  getLatestUndoEditSelection,
  getUndoEditPreviewMessages,
  navigateUndoEditSelection,
} from '../../electron/cli/undoEditNavigation'

const messages: Message[] = [
  { content: 'first prompt', id: 'user-1', role: 'user', timestamp: 1, userMessageKind: 'human' },
  { content: 'first answer', id: 'assistant-1', role: 'assistant', timestamp: 2 },
  { content: 'internal user context', id: 'user-context', role: 'user', timestamp: 3, userMessageKind: 'system' },
  { content: 'second prompt', id: 'user-2', role: 'user', timestamp: 4, userMessageKind: 'human' },
  { content: 'second answer', id: 'assistant-2', role: 'assistant', timestamp: 5 },
  { content: 'third prompt', id: 'user-3', role: 'user', timestamp: 6, userMessageKind: 'human' },
]

test('undo edit selection starts at the latest human user turn', () => {
  const selection = getLatestUndoEditSelection(messages)
  assert.equal(selection?.targetUserMessageId, 'user-3')
  assert.equal(selection?.text, 'third prompt')
})

test('undo edit preview shows the conversation immediately before the selected user turn', () => {
  assert.deepEqual(
    getUndoEditPreviewMessages(messages, 'user-2')?.map((message) => message.id),
    ['user-1', 'assistant-1', 'user-context'],
  )
  assert.deepEqual(getUndoEditPreviewMessages(messages, 'user-1'), [])
  assert.equal(getUndoEditPreviewMessages(messages, 'missing-user'), null)
})

test('undo edit selection navigates older and newer human turns without wrapping', () => {
  assert.equal(navigateUndoEditSelection(messages, 'user-3', 'older')?.targetUserMessageId, 'user-2')
  assert.equal(navigateUndoEditSelection(messages, 'user-2', 'older')?.targetUserMessageId, 'user-1')
  assert.equal(navigateUndoEditSelection(messages, 'user-1', 'older'), null)

  assert.equal(navigateUndoEditSelection(messages, 'user-1', 'newer')?.targetUserMessageId, 'user-2')
  assert.equal(navigateUndoEditSelection(messages, 'user-2', 'newer')?.targetUserMessageId, 'user-3')
  assert.equal(navigateUndoEditSelection(messages, 'user-3', 'newer'), null)
})
