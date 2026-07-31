import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatAssistantDraftManager } from '../src/hooks/chatAssistantDrafts'
import type { ChatRuntimeSelection } from '../src/hooks/chatMessageRuntime'
import type { Message } from '../src/types/chat'

function createRuntimeSelection(): ChatRuntimeSelection {
  return {
    hasConfiguredProvider: true,
    modelId: 'gpt-5.4',
    providerId: 'custom:test-provider',
    providerLabel: 'OpenAI Compatible',
    reasoningEffort: 'medium',
    terminalExecutionMode: 'sandbox',
  }
}

function createDraftManager() {
  const messages: Message[] = []
  const runtimeSelection = createRuntimeSelection()
  const getMessages = () => messages

  const draftManager = createChatAssistantDraftManager({
    appendLocalMessage: (_conversationId, message) => {
      messages.push(message)
    },
    conversationId: 'conversation-1',
    initialConversationMessages: [],
    markTextStreamingPulse: () => {},
    onConversationMessagesUpdated: (nextMessages) => {
      messages.splice(0, messages.length, ...nextMessages)
    },
    providerId: 'custom:test-provider',
    removeLocalMessage: (_conversationId, messageId) => {
      const nextMessages = messages.filter((message) => message.id !== messageId)
      messages.splice(0, messages.length, ...nextMessages)
    },
    runtimeSelection,
    stopTextStreaming: () => {},
    updateConversationRuntimeState: () => {},
    updateLocalMessage: (_conversationId, messageId, updater) => {
      const nextMessages = messages.map((message) => (message.id === messageId ? updater(message) : message))
      messages.splice(0, messages.length, ...nextMessages)
    },
  })

  return {
    draftManager,
    getMessages,
  }
}

test('chat assistant drafts start a new think block after the previous one has completed', () => {
  const { draftManager } = createDraftManager()

  draftManager.appendPlaceholderDraft()
  draftManager.handleReasoningDelta('First reasoning block')
  draftManager.handleReasoningCompleted()
  draftManager.handleContentDelta('First answer')
  draftManager.handleReasoningDelta('Second reasoning block')
  draftManager.handleReasoningCompleted()
  draftManager.handleContentDelta('Second answer')

  const streamedMessages = draftManager.finalizeStreamedMessages(false)

  assert.ok(streamedMessages)
  assert.equal(streamedMessages.length, 2)
  assert.equal(streamedMessages[0]?.role, 'assistant')
  assert.equal(streamedMessages[1]?.role, 'assistant')
  assert.equal(streamedMessages[0]?.reasoningContent?.trim(), 'First reasoning block')
  assert.equal(streamedMessages[0]?.content.trim(), 'First answer')
  assert.equal(streamedMessages[1]?.reasoningContent?.trim(), 'Second reasoning block')
  assert.equal(streamedMessages[1]?.content.trim(), 'Second answer')
})

test('chat assistant drafts create a fresh think block after a tool boundary', () => {
  const { draftManager } = createDraftManager()

  draftManager.appendPlaceholderDraft()
  draftManager.handleReasoningDelta('First reasoning block')
  draftManager.handleReasoningCompleted()
  draftManager.handleToolInvocationStarted('tool-call-1', {
    argumentsText: '{"path":"C:/repo/src/example.ts"}',
    startedAt: 10,
    toolName: 'read',
  })
  draftManager.handleSyntheticToolMessage({
    content: 'Read src/example.ts',
    id: 'tool-message-1',
    role: 'tool',
    timestamp: 11,
    toolCallId: 'tool-call-1',
  })
  draftManager.handleToolInvocationCompleted('tool-call-1', {
    argumentsText: '{"path":"C:/repo/src/example.ts"}',
    completedAt: 12,
    resultContent: 'Read src/example.ts',
    resultPresentation: undefined,
    toolName: 'read',
  })
  draftManager.handleReasoningDelta('Second reasoning block')
  draftManager.handleReasoningCompleted()

  const streamedMessages = draftManager.finalizeStreamedMessages(false)

  assert.ok(streamedMessages)
  assert.equal(streamedMessages.length, 4)
  assert.equal(streamedMessages[0]?.role, 'assistant')
  assert.equal(streamedMessages[0]?.reasoningContent?.trim(), 'First reasoning block')
  assert.equal(streamedMessages[0]?.toolInvocations?.length ?? 0, 0)
  assert.equal(streamedMessages[1]?.role, 'assistant')
  assert.equal(streamedMessages[1]?.toolInvocations?.length, 1)
  assert.equal(streamedMessages[2]?.role, 'tool')
  assert.equal(streamedMessages[3]?.role, 'assistant')
  assert.equal(streamedMessages[3]?.reasoningContent?.trim(), 'Second reasoning block')
  assert.equal(streamedMessages[3]?.toolInvocations?.length ?? 0, 0)
})

test('chat assistant drafts keep consecutive reasoning-only segments in the same think block', () => {
  const { draftManager } = createDraftManager()

  draftManager.appendPlaceholderDraft()
  draftManager.handleReasoningDelta('First reasoning block')
  draftManager.handleReasoningCompleted()
  draftManager.handleReasoningDelta('Second reasoning block')
  draftManager.handleReasoningCompleted()

  const streamedMessages = draftManager.finalizeStreamedMessages(false)

  assert.ok(streamedMessages)
  assert.equal(streamedMessages.length, 1)
  assert.equal(streamedMessages[0]?.role, 'assistant')
  assert.equal(
    streamedMessages[0]?.reasoningContent?.trim(),
    'First reasoning block\n\nSecond reasoning block',
  )
  assert.equal(streamedMessages[0]?.content.trim(), '')
})

test('chat assistant drafts preserve streamed triple-backtick closers across single-character deltas', () => {
  const { draftManager, getMessages } = createDraftManager()

  draftManager.appendPlaceholderDraft()
  draftManager.handleContentDelta('```ts\nconst value = 1\n')
  draftManager.handleContentDelta('`')
  draftManager.handleContentDelta('`')
  draftManager.handleContentDelta('`')

  const latestDraftAssistantMessage = [...getMessages()].reverse().find((message) => message.role === 'assistant')
  assert.equal(latestDraftAssistantMessage?.role, 'assistant')
  assert.equal(latestDraftAssistantMessage?.content, '```ts\nconst value = 1\n```')
})

test('chat assistant drafts remove incomplete tool calls when a stream is aborted', () => {
  const { draftManager, getMessages } = createDraftManager()

  draftManager.appendPlaceholderDraft()
  draftManager.handleToolInvocationStarted('tool-call-1', {
    argumentsText: '{"session_id":1}',
    startedAt: 10,
    toolName: 'get_terminal_output',
  })

  const streamedMessages = draftManager.finalizeStreamedMessages(true)

  assert.equal(streamedMessages, null)
  assert.equal(getMessages().length, 0)
})

test('chat assistant drafts keep failure text but drop incomplete tool calls after an interrupted run', () => {
  const { draftManager } = createDraftManager()

  draftManager.appendPlaceholderDraft()
  draftManager.handleToolInvocationStarted('tool-call-1', {
    argumentsText: '{"session_id":1}',
    startedAt: 10,
    toolName: 'get_terminal_output',
  })

  const streamedMessages = draftManager.finalizeStreamedMessages(false, 'Request failed before the tool completed.')

  assert.ok(streamedMessages)
  assert.equal(streamedMessages.length, 1)
  assert.equal(streamedMessages[0]?.role, 'assistant')
  assert.equal(streamedMessages[0]?.content, 'Request failed before the tool completed.')
  assert.equal(streamedMessages[0]?.toolInvocations?.length ?? 0, 0)
})
