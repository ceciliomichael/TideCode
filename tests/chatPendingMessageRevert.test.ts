import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getActiveUnrespondedUserMessage,
  getPendingRevertMessageIds,
  isActiveUnrespondedUserMessage,
} from '../src/hooks/chatPendingMessageRevert'
import { getMessagesBeforeUserMessage } from '../src/hooks/chatHistoryWorkflows'
import type { Message } from '../src/types/chat'

function createUserMessage(id: string): Message {
  return {
    content: 'Send this back to the composer',
    id,
    role: 'user',
    timestamp: 1,
  }
}

function createAssistantMessage(id: string, content: string): Message {
  return {
    content,
    id,
    role: 'assistant',
    timestamp: 2,
  }
}

function createConversationState(messages: Message[], isSending = true) {
  return {
    conversation: { messages },
    isSending,
  }
}

test('pending user turns can be reverted while the assistant has not produced output', () => {
  const userMessage = createUserMessage('user-1')
  const assistantPlaceholder: Message = {
    content: '',
    id: 'assistant-placeholder',
    role: 'assistant',
    timestamp: 2,
  }
  const conversationState = createConversationState([userMessage, assistantPlaceholder])

  assert.equal(
    isActiveUnrespondedUserMessage(conversationState, userMessage.id),
    true,
  )
  assert.equal(getActiveUnrespondedUserMessage(createConversationState([userMessage]), undefined)?.id, userMessage.id)
  assert.deepEqual(getPendingRevertMessageIds(conversationState, userMessage.id), [
    'user-1',
    'assistant-placeholder',
  ])
})

test('a user turn is no longer pending once assistant output exists', () => {
  const userMessage = createUserMessage('user-1')

  assert.equal(
    isActiveUnrespondedUserMessage(
      createConversationState([userMessage, createAssistantMessage('assistant-1', 'The response started.')]),
      userMessage.id,
    ),
    false,
  )
})

test('a later user turn is not treated as the pending revert target', () => {
  const firstUserMessage = createUserMessage('user-1')
  const secondUserMessage = { ...createUserMessage('user-2'), content: 'A later turn' }

  assert.equal(
    isActiveUnrespondedUserMessage(createConversationState([firstUserMessage, secondUserMessage]), firstUserMessage.id),
    false,
  )
})

test('rollback removes the reverted user turn and all response messages generated after it', () => {
  const messages: Message[] = [
    createUserMessage('previous-user'),
    createAssistantMessage('previous-assistant', 'Earlier response'),
    createUserMessage('reverted-user'),
    createAssistantMessage('partial-assistant', 'Partial response'),
  ]

  assert.deepEqual(
    getMessagesBeforeUserMessage(messages, 'reverted-user')?.map((message) => message.id),
    ['previous-user', 'previous-assistant'],
  )
})
