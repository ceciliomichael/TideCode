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
  const messageUpdateOptions: Array<{ immediate?: boolean; transient?: boolean } | undefined> = []
  const runtimePatches: Record<string, unknown>[] = []
  const runtimeSelection = createRuntimeSelection()
  const getMessages = () => messages

  const draftManager = createChatAssistantDraftManager({
    appendLocalMessage: (_conversationId, message) => {
      messages.push(message)
    },
    conversationId: 'conversation-1',
    initialConversationMessages: [],
    markTextStreamingPulse: () => {},
    onConversationMessagesUpdated: (nextMessages, options) => {
      messageUpdateOptions.push(options)
      messages.splice(0, messages.length, ...nextMessages)
    },
    providerId: 'custom:test-provider',
    removeLocalMessage: (_conversationId, messageId) => {
      const nextMessages = messages.filter((message) => message.id !== messageId)
      messages.splice(0, messages.length, ...nextMessages)
    },
    runtimeSelection,
    stopTextStreaming: () => {},
    updateConversationRuntimeState: (_conversationId, patch) => {
      runtimePatches.push(patch)
    },
    updateLocalMessage: (_conversationId, messageId, updater) => {
      const nextMessages = messages.map((message) => (message.id === messageId ? updater(message) : message))
      messages.splice(0, messages.length, ...nextMessages)
    },
  })

  return {
    draftManager,
    getMessages,
    messageUpdateOptions,
    runtimePatches,
  }
}

test('chat assistant drafts close the previous work block and group later tools after consumed steers', () => {
  const { draftManager, runtimePatches } = createDraftManager()

  draftManager.appendPlaceholderDraft()
  draftManager.handleToolInvocationStarted('tool-call-1', {
    argumentsText: '{}',
    startedAt: 10,
    toolName: 'read',
  })
  draftManager.handleToolInvocationCompleted('tool-call-1', {
    argumentsText: '{}',
    completedAt: 12,
    resultContent: 'done',
    resultPresentation: undefined,
    toolName: 'read',
  })
  draftManager.handleSyntheticToolMessage({
    content: 'done',
    id: 'tool-result-1',
    role: 'tool',
    timestamp: 12,
    toolCallId: 'tool-call-1',
  })
  const runtimePatchCountBeforeSteer = runtimePatches.length
  draftManager.handleSteerMessagesConsumed([
    {
      content: 'first steer',
      id: 'steer-1',
      role: 'user',
      timestamp: 13,
    },
    {
      content: 'second steer',
      id: 'steer-2',
      role: 'user',
      timestamp: 14,
    },
  ])
  const runtimePatchCountAfterSteer = runtimePatches.length
  draftManager.handleToolInvocationStarted('tool-call-2', {
    argumentsText: '{}',
    startedAt: 15,
    toolName: 'write',
  })
  draftManager.handleToolInvocationCompleted('tool-call-2', {
    argumentsText: '{}',
    completedAt: 16,
    resultContent: 'written',
    resultPresentation: undefined,
    toolName: 'write',
  })
  draftManager.handleSyntheticToolMessage({
    content: 'written',
    id: 'tool-result-2',
    role: 'tool',
    timestamp: 16,
    toolCallId: 'tool-call-2',
  })

  const streamedMessages = draftManager.finalizeStreamedMessages(false)

  assert.ok(streamedMessages)
  assert.deepEqual(streamedMessages.map((message) => message.role), [
    'assistant',
    'tool',
    'user',
    'user',
    'assistant',
    'tool',
  ])
  assert.deepEqual(
    streamedMessages.filter((message) => message.role === 'user').map((message) => message.id),
    ['steer-1', 'steer-2'],
  )
  const assistantMessages = streamedMessages.filter((message) => message.role === 'assistant')
  assert.deepEqual(assistantMessages[0]?.toolInvocations?.map((invocation) => invocation.id), ['tool-call-1'])
  assert.deepEqual(assistantMessages[1]?.toolInvocations?.map((invocation) => invocation.id), ['tool-call-2'])
  const steerRuntimePatches = runtimePatches.slice(runtimePatchCountBeforeSteer, runtimePatchCountAfterSteer)
  assert.equal(
    steerRuntimePatches.some((patch) => patch.streamingAssistantMessageId === null),
    false,
    'consuming a steer must not publish a transient non-streaming frame',
  )
})

test('chat assistant drafts append a placeholder draft and transition to thinking block after steer messages are consumed', () => {
  const { draftManager, getMessages, runtimePatches } = createDraftManager()

  draftManager.appendPlaceholderDraft()
  draftManager.handleSteerMessagesConsumed([
    {
      content: 'steer instruction',
      id: 'steer-1',
      role: 'user',
      timestamp: 100,
    },
  ])

  // Initial placeholder draft, steer message, and new steer placeholder draft exist
  const messagesAfterSteer = getMessages()
  assert.equal(messagesAfterSteer.length, 3)
  assert.equal(messagesAfterSteer[1]?.id, 'steer-1')
  assert.equal(messagesAfterSteer[2]?.role, 'assistant')

  // Streaming assistant message ID should point to the new placeholder assistant draft
  const latestPatch = runtimePatches.at(-1)
  assert.equal(latestPatch?.streamingAssistantMessageId, messagesAfterSteer[2]?.id)
  assert.ok(latestPatch?.streamingWaitingIndicatorVariant)

  // When reasoning delta arrives, it updates the draft with reasoningContent
  draftManager.handleReasoningDelta('AI reasoning after steer')
  const messagesAfterReasoning = getMessages()
  assert.equal(messagesAfterReasoning[2]?.reasoningContent?.trim(), 'AI reasoning after steer')

  const streamedMessages = draftManager.finalizeStreamedMessages(false)
  assert.ok(streamedMessages)
  assert.equal(streamedMessages.length, 2)
  assert.equal(streamedMessages[0]?.id, 'steer-1')
  assert.equal(streamedMessages[1]?.reasoningContent?.trim(), 'AI reasoning after steer')
})

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

test('chat assistant drafts start a fresh assistant block after compaction', () => {
  const { draftManager } = createDraftManager()

  draftManager.appendPlaceholderDraft()
  draftManager.handleToolInvocationStarted('tool-call-1', {
    argumentsText: '{"path":"C:/repo/src/example.ts"}',
    startedAt: 10,
    toolName: 'read',
  })
  draftManager.handleToolInvocationCompleted('tool-call-1', {
    argumentsText: '{"path":"C:/repo/src/example.ts"}',
    completedAt: 12,
    resultContent: 'Read src/example.ts',
    resultPresentation: undefined,
    toolName: 'read',
  })

  draftManager.handleCompactionCommitted()
  draftManager.handleToolInvocationStarted('tool-call-2', {
    argumentsText: '{"path":"C:/repo/src/next.ts"}',
    startedAt: 20,
    toolName: 'read',
  })
  draftManager.handleToolInvocationCompleted('tool-call-2', {
    argumentsText: '{"path":"C:/repo/src/next.ts"}',
    completedAt: 22,
    resultContent: 'Read src/next.ts',
    resultPresentation: undefined,
    toolName: 'read',
  })

  const streamedMessages = draftManager.finalizeStreamedMessages(false)

  assert.ok(streamedMessages)
  const assistantMessages = streamedMessages.filter((message) => message.role === 'assistant')
  assert.equal(assistantMessages.length, 2)
  assert.deepEqual(assistantMessages.map((message) => message.toolInvocations?.map((tool) => tool.id)), [
    ['tool-call-1'],
    ['tool-call-2'],
  ])
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

test('chat assistant drafts keep reasoning active when reasoning content arrives after reasoning-end', () => {
  const { draftManager, getMessages } = createDraftManager()

  draftManager.appendPlaceholderDraft()
  draftManager.handleReasoningDelta('First reasoning block')
  draftManager.handleReasoningCompleted()

  let activeMessage = [...getMessages()].reverse().find((message) => message.role === 'assistant')
  assert.equal(activeMessage?.reasoningCompletedAt, undefined)

  draftManager.handleReasoningDelta('Trailing reasoning block')
  activeMessage = [...getMessages()].reverse().find((message) => message.role === 'assistant')
  assert.equal(activeMessage?.reasoningCompletedAt, undefined)
  assert.match(activeMessage?.reasoningContent ?? '', /First reasoning block/u)
  assert.match(activeMessage?.reasoningContent ?? '', /Trailing reasoning block/u)

  draftManager.handleContentDelta('Final answer')
  activeMessage = [...getMessages()].reverse().find((message) => message.role === 'assistant')
  assert.equal(typeof activeMessage?.reasoningCompletedAt, 'number')
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

test('chat assistant drafts flush the latest coalesced tool arguments before finalization', () => {
  const { draftManager } = createDraftManager()

  draftManager.appendPlaceholderDraft()
  draftManager.handleToolInvocationStarted('tool-call-coalesced', {
    argumentsText: '',
    startedAt: 10,
    toolName: 'read',
  })
  draftManager.handleToolInvocationDelta('tool-call-coalesced', {
    argumentsText: '{"path":"README.md"}',
    toolName: 'read',
  })

  const streamedMessages = draftManager.finalizeStreamedMessages(true)

  assert.ok(streamedMessages)
  const assistantMessage = streamedMessages.find((message) => message.role === 'assistant')
  assert.equal(assistantMessage?.toolInvocations?.[0]?.argumentsText, '{"path":"README.md"}')
  assert.equal(assistantMessage?.toolInvocations?.[0]?.state, 'failed')
})

test('partial tool argument snapshots are marked transient until the tool reaches a boundary', () => {
  const { draftManager, messageUpdateOptions } = createDraftManager()

  draftManager.appendPlaceholderDraft()
  draftManager.handleToolInvocationStarted('tool-call-transient', {
    argumentsText: '',
    startedAt: 10,
    toolName: 'apply_patch',
  })
  const optionCountBeforeDelta = messageUpdateOptions.length
  draftManager.handleToolInvocationDelta('tool-call-transient', {
    argumentsText: 'x'.repeat(100_000),
    toolName: 'apply_patch',
  })
  draftManager.handleToolInvocationCompleted('tool-call-transient', {
    argumentsText: 'x'.repeat(100_000),
    completedAt: 12,
    resultContent: 'done',
    resultPresentation: undefined,
    toolName: 'apply_patch',
  })

  const deltaAndCompletionOptions = messageUpdateOptions.slice(optionCountBeforeDelta)
  assert.equal(deltaAndCompletionOptions.some((options) => options?.transient === true), true)
  assert.equal(deltaAndCompletionOptions.some((options) => options?.immediate === true), true)
})

test('chat assistant drafts finalize incomplete tool calls when a stream is aborted', () => {
  const { draftManager, getMessages } = createDraftManager()

  draftManager.appendPlaceholderDraft()
  draftManager.handleToolInvocationStarted('tool-call-1', {
    argumentsText: '{"session_id":1}',
    startedAt: 10,
    toolName: 'get_terminal_output',
  })

  const streamedMessages = draftManager.finalizeStreamedMessages(true)

  assert.ok(streamedMessages)
  const assistantMessage = streamedMessages.find((message) => message.role === 'assistant')
  const toolMessage = streamedMessages.find((message) => message.role === 'tool')
  assert.equal(assistantMessage?.toolInvocations?.[0]?.state, 'failed')
  assert.equal(assistantMessage?.toolInvocations?.[0]?.resultContent?.includes('Tool execution terminated'), true)
  assert.equal(toolMessage?.role, 'tool')
  assert.equal(toolMessage?.content.includes('Tool execution terminated'), true)
  assert.equal(getMessages().some((message) => message.role === 'tool'), true)
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
