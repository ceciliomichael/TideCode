import assert from 'node:assert/strict'
import test from 'node:test'
import { persistAndStreamMessage } from '../../src/hooks/chatMessageSendWorkflow'
import { createTerminatedToolResultContent } from '../../src/lib/toolResultContent'
import type { ChatRuntimeSelection } from '../../src/hooks/chatMessageRuntime'
import type { PersistAndStreamMessageInput } from '../../src/hooks/chatMessageSendTypes'
import type { ConversationRecord, Message } from '../../src/types/chat'

interface HistoryCall {
  conversationId: string
  messages: Message[]
  type: 'append' | 'replace'
}

function createConversation(id = 'conversation-1'): ConversationRecord {
  return {
    agentContextRootPath: `/tmp/agent-contexts/${id}`,
    chatMode: 'agent',
    createdAt: 1,
    folderId: null,
    id,
    messages: [],
    title: 'New chat',
    updatedAt: 1,
  }
}

function createFakeHistory(initialConversation: ConversationRecord) {
  const conversations = new Map<string, ConversationRecord>([[initialConversation.id, initialConversation]])
  const calls: HistoryCall[] = []

  return {
    calls,
    conversations,
    getStoredMessages: (conversationId: string) => conversations.get(conversationId)?.messages ?? [],
    api: {
      getConversation: async (conversationId: string) => conversations.get(conversationId) ?? null,
      appendMessages: async (input: {
        chatMode?: string
        conversationId: string
        messages: Message[]
        title?: string
      }) => {
        const existing = conversations.get(input.conversationId)
        if (!existing) {
          throw new Error(`Conversation not found: ${input.conversationId}`)
        }

        calls.push({ conversationId: input.conversationId, messages: input.messages, type: 'append' })
        const existingIds = new Set(existing.messages.map((message) => message.id))
        const uniqueMessages = input.messages.filter((message) => !existingIds.has(message.id))
        const nextConversation: ConversationRecord = {
          ...existing,
          messages: [...existing.messages, ...uniqueMessages],
          title: input.title?.trim() ? input.title.trim() : existing.title,
          updatedAt: Date.now(),
        }
        conversations.set(input.conversationId, nextConversation)
        return nextConversation
      },
      replaceMessages: async (input: {
        chatMode?: string
        conversationId: string
        messages: Message[]
        title?: string
      }) => {
        const existing = conversations.get(input.conversationId)
        if (!existing) {
          throw new Error(`Conversation not found: ${input.conversationId}`)
        }

        calls.push({ conversationId: input.conversationId, messages: input.messages, type: 'replace' })
        const nextConversation: ConversationRecord = {
          ...existing,
          messages: input.messages,
          title: input.title?.trim() ? input.title.trim() : existing.title,
          updatedAt: Date.now(),
        }
        conversations.set(input.conversationId, nextConversation)
        return nextConversation
      },
    },
  }
}

interface WorkflowHarnessOptions {
  isUserMessageReverted?: boolean
  hasPendingAbortRequest?: boolean
  consumePendingAbortBeforeStreamStart?: boolean
  originalText?: string
  shouldApplyAbortRollbackToRuntime?: boolean
  shouldRestoreMainComposerOnAbort?: boolean
  streamContent?: string | null
  streamToolInvocation?: boolean
  streamOutcome?: 'completed' | 'aborted' | 'error'
}

function createWorkflowHarness(options: WorkflowHarnessOptions = {}) {
  const conversation = createConversation()
  const history = createFakeHistory(conversation)
  const runtimeStatesRef = {
    current: {} as Record<string, PersistAndStreamMessageInput['conversationRuntimeStatesRef']['current'][string]>,
  }
  const activeConversationIdRef = { current: conversation.id }
  const selectedFolderIdRef = { current: null }
  let streamListener: ((event: Record<string, unknown> & { streamId: string; type: string }) => void) | null = null
  const errors: string[] = []
  const composerValues: string[] = []
  const originalText = options.originalText ?? 'Please update the README'

  const upsertConversationRecord = (nextConversation: ConversationRecord) => {
    const existingState = runtimeStatesRef.current[nextConversation.id]
    runtimeStatesRef.current[nextConversation.id] = {
      activeStreamId: existingState?.activeStreamId ?? null,
      conversation: nextConversation,
      isSending: existingState?.isSending ?? false,
      isStreamingTextActive: existingState?.isStreamingTextActive ?? false,
      streamingAssistantMessageId: existingState?.streamingAssistantMessageId ?? null,
      streamingWaitingIndicatorVariant: existingState?.streamingWaitingIndicatorVariant ?? null,
    }
  }

  const updateConversationRuntimeState = (
    conversationId: string,
    patch: {
      activeStreamId?: string | null
      isSending?: boolean
      isStreamingTextActive?: boolean
      streamingAssistantMessageId?: string | null
      streamingWaitingIndicatorVariant?: string | null
    },
  ) => {
    const existingState = runtimeStatesRef.current[conversationId]
    if (!existingState) {
      return
    }

    runtimeStatesRef.current[conversationId] = {
      ...existingState,
      ...(patch.activeStreamId !== undefined ? { activeStreamId: patch.activeStreamId } : {}),
      ...(patch.isSending !== undefined ? { isSending: patch.isSending } : {}),
      ...(patch.isStreamingTextActive !== undefined ? { isStreamingTextActive: patch.isStreamingTextActive } : {}),
      ...(patch.streamingAssistantMessageId !== undefined
        ? { streamingAssistantMessageId: patch.streamingAssistantMessageId }
        : {}),
      ...(patch.streamingWaitingIndicatorVariant !== undefined
        ? { streamingWaitingIndicatorVariant: patch.streamingWaitingIndicatorVariant }
        : {}),
    }
  }

  const input: PersistAndStreamMessageInput = {
    activeConversationId: conversation.id,
    activeConversationIdRef,
    applyConversation: (nextConversation) => {
      upsertConversationRecord(nextConversation)
      activeConversationIdRef.current = nextConversation.id
    },
    appendLocalMessage: (conversationId, message) => {
      const existingState = runtimeStatesRef.current[conversationId]
      if (!existingState) {
        return
      }
      runtimeStatesRef.current[conversationId] = {
        ...existingState,
        conversation: {
          ...existingState.conversation,
          messages: [...existingState.conversation.messages, message],
        },
      }
    },
    attachments: [],
    clearError: () => undefined,
    clearTextStreamingIdleTimeout: () => undefined,
    clearUserMessageRevert: () => undefined,
    completeEditingMessage: () => undefined,
    consumePendingAbortBeforeStreamStart: () => options.consumePendingAbortBeforeStreamStart ?? false,
    conversationRuntimeStatesRef: runtimeStatesRef,
    draftChatMode: 'agent',
    hasPendingAbortRequest: () => options.hasPendingAbortRequest ?? false,
    isUserMessageReverted: () => options.isUserMessageReverted ?? false,
    markTextStreamingPulse: () => undefined,
    originalText,
    removeLocalMessage: (conversationId, messageId) => {
      const existingState = runtimeStatesRef.current[conversationId]
      if (!existingState) {
        return
      }
      runtimeStatesRef.current[conversationId] = {
        ...existingState,
        conversation: {
          ...existingState.conversation,
          messages: existingState.conversation.messages.filter((message) => message.id !== messageId),
        },
      }
    },
    resetMainComposerAfterSend: true,
    runtimeSelection: {
      contextCompaction: { enabled: false, threshold: 0 },
      hasConfiguredProvider: true,
      modelId: 'gpt-5',
      providerId: 'codex',
      providerLabel: 'Codex',
      reasoningEffort: 'low',
      terminalExecutionMode: 'auto',
    } as ChatRuntimeSelection,
    selectedFolderId: null,
    selectedFolderIdRef,
    shouldApplyAbortRollbackToRuntime: () => options.shouldApplyAbortRollbackToRuntime ?? true,
    shouldRestoreMainComposerOnAbort: () => options.shouldRestoreMainComposerOnAbort ?? true,
    setError: (errorMessage) => {
      if (errorMessage) {
        errors.push(errorMessage)
      }
    },
    setMainComposerAttachments: () => undefined,
    setMainComposerMentionPathMap: () => undefined,
    setMainComposerValue: (value) => {
      composerValues.push(value)
    },
    setPendingDraftSendCount: () => undefined,
    stopTextStreaming: () => undefined,
    targetEditMessageId: null,
    trimmedText: originalText,
    updateConversationRuntimeState,
    updateConversationSummary: () => undefined,
    updateLocalMessage: (conversationId, messageId, updater) => {
      const existingState = runtimeStatesRef.current[conversationId]
      if (!existingState) {
        return
      }
      runtimeStatesRef.current[conversationId] = {
        ...existingState,
        conversation: {
          ...existingState.conversation,
          messages: existingState.conversation.messages.map((message) =>
            message.id === messageId ? updater(message) : message,
          ),
        },
      }
    },
    upsertConversation: upsertConversationRecord,
  }

  const streamId = 'stream-1'

  const windowStub = {
    clearTimeout,
    setTimeout,
    tidecodeChat: {
      cancelStream: async () => true,
      onStreamEvent: (listener: (event: Record<string, unknown> & { streamId: string; type: string }) => void) => {
        streamListener = listener
        return () => {
          streamListener = null
        }
      },
      startStream: async () => {
        queueMicrotask(() => {
          if (options.streamContent) {
            streamListener?.({ delta: options.streamContent, streamId, type: 'content_delta' })
          }
          if (options.streamToolInvocation) {
            const argumentsText = '{"command":"npm run lint"}'
            const resultContent = createTerminatedToolResultContent({
              argumentsValue: { command: 'npm run lint' },
              toolCallId: 'tool-call-1',
              toolName: 'execute_terminal',
            })
            streamListener?.({
              argumentsText,
              invocationId: 'tool-call-1',
              startedAt: 1,
              streamId,
              toolName: 'execute_terminal',
              type: 'tool_invocation_started',
            })
            streamListener?.({
              argumentsText,
              completedAt: 2,
              errorMessage: 'Tool execution terminated',
              invocationId: 'tool-call-1',
              resultContent,
              streamId,
              syntheticMessage: {
                content: resultContent,
                id: 'tool-result-1',
                role: 'tool',
                timestamp: 2,
                toolCallId: 'tool-call-1',
              },
              toolName: 'execute_terminal',
              type: 'tool_invocation_failed',
            })
          }
          streamListener?.({ streamId, type: options.streamOutcome ?? 'completed' })
        })
        return { streamId }
      },
    },
    tidecodeHistory: history.api,
    tidecodeWorkspace: {
      createCheckpoint: async () => ({ createdAt: Date.now(), id: 'checkpoint-1' }),
    },
  }

  const globalScope = globalThis as Record<string, unknown>
  const previousWindow = globalScope.window
  globalScope.window = windowStub


  return {
    activeConversationIdRef,
    composerValues,
    conversation,
    errors,
    getRuntimeMessages: (conversationId: string) =>
      runtimeStatesRef.current[conversationId]?.conversation.messages ?? [],
    history,
    input,
    restoreWindow: () => {
      if (previousWindow === undefined) {
        delete globalScope.window
      } else {
        globalScope.window = previousWindow
      }
    },
  }
}

test('a stream that completes after the turn was reverted must not resurrect the user message in history', async () => {
  const harness = createWorkflowHarness({
    isUserMessageReverted: true,
    streamContent: 'Hello from the ghost stream',
    streamOutcome: 'completed',
  })

  try {
    const accepted = await persistAndStreamMessage(harness.input)

    assert.equal(accepted, true)
    assert.deepEqual(harness.history.getStoredMessages(harness.conversation.id), [], 'history must be rolled back')
    assert.equal(
      harness.history.calls.some((call) => call.type === 'replace' && call.messages.length === 0),
      true,
      'a rollback replace must be written after the ghost stream completed',
    )
    assert.deepEqual(harness.composerValues, ['Please update the README'], 'composer must be restored')
  } finally {
    harness.restoreWindow()
  }
})

test('a normal completed stream persists the user message and the assistant response', async () => {
  const harness = createWorkflowHarness({
    streamContent: 'Here is the updated README',
    streamOutcome: 'completed',
  })

  try {
    const accepted = await persistAndStreamMessage(harness.input)

    assert.equal(accepted, true)
    const storedMessages = harness.history.getStoredMessages(harness.conversation.id)
    assert.equal(storedMessages.length, 2, 'user message and assistant response must be stored')
    assert.equal(storedMessages[0]?.role, 'user')
    assert.equal(storedMessages[1]?.role, 'assistant')
    assert.equal(storedMessages[1]?.content, 'Here is the updated README')
  } finally {
    harness.restoreWindow()
  }
})

test('an aborted tool remains in persisted history with a terminated result', async () => {
  const harness = createWorkflowHarness({
    streamOutcome: 'aborted',
    streamToolInvocation: true,
  })

  try {
    const accepted = await persistAndStreamMessage(harness.input)

    assert.equal(accepted, true)
    const storedMessages = harness.history.getStoredMessages(harness.conversation.id)
    const storedToolMessage = storedMessages.find((message) => message.role === 'tool')
    const storedAssistantMessage = storedMessages.find((message) => message.role === 'assistant')
    assert.ok(storedAssistantMessage?.toolInvocations?.some((invocation) => invocation.state === 'failed'))
    assert.equal(storedToolMessage?.content.includes('Tool execution terminated'), true)
  } finally {
    harness.restoreWindow()
  }
})

test('a completed plan handoff keeps its status divider message in conversation history', async () => {
  const handoffMessage = '<plan_123456>Implement the plan in .tidecode/plans/plan-001.md.</plan_123456>'
  const harness = createWorkflowHarness({
    originalText: handoffMessage,
    streamContent: 'I will implement the approved plan.',
    streamOutcome: 'completed',
  })

  try {
    const accepted = await persistAndStreamMessage(harness.input)

    assert.equal(accepted, true)
    const storedMessages = harness.history.getStoredMessages(harness.conversation.id)
    assert.equal(storedMessages[0]?.content, handoffMessage)
    assert.equal(storedMessages[1]?.content, 'I will implement the approved plan.')
  } finally {
    harness.restoreWindow()
  }
})

test('a stop clicked before the stream starts rolls the stored conversation back', async () => {
  const harness = createWorkflowHarness({
    consumePendingAbortBeforeStreamStart: true,
    hasPendingAbortRequest: true,
  })

  try {
    const accepted = await persistAndStreamMessage(harness.input)

    assert.equal(accepted, true)
    assert.deepEqual(harness.history.getStoredMessages(harness.conversation.id), [], 'history must be rolled back')
    assert.equal(harness.history.calls.some((call) => call.type === 'replace'), true)
  } finally {
    harness.restoreWindow()
  }
})

test('an edit takeover abort does not move the original message into the main composer', async () => {
  const harness = createWorkflowHarness({
    hasPendingAbortRequest: true,
    shouldApplyAbortRollbackToRuntime: false,
    shouldRestoreMainComposerOnAbort: false,
    streamOutcome: 'aborted',
  })

  try {
    const accepted = await persistAndStreamMessage(harness.input)

    assert.equal(accepted, true)
    assert.deepEqual(harness.history.getStoredMessages(harness.conversation.id), [], 'history must be rolled back')
    assert.deepEqual(harness.composerValues, [''], 'the original message must stay out of the main composer')
    assert.equal(
      harness.getRuntimeMessages(harness.conversation.id).some((message) => message.role === 'user'),
      true,
      'the edited user bubble must remain mounted while the replacement send takes over',
    )
  } finally {
    harness.restoreWindow()
  }
})

test('aborting a plan implementation run does not restore its status marker to the composer', async () => {
  const harness = createWorkflowHarness({
    originalText: '<plan_123456>Implement the plan in .tidecode/plans/plan-001.md.</plan_123456>',
    streamOutcome: 'aborted',
  })

  try {
    const accepted = await persistAndStreamMessage(harness.input)

    assert.equal(accepted, true)
    assert.deepEqual(harness.history.getStoredMessages(harness.conversation.id), [], 'history must be rolled back')
    assert.deepEqual(harness.composerValues, [''], 'the implementation marker must not return to the composer')
  } finally {
    harness.restoreWindow()
  }
})

test('aborting a plan revision request does not restore its status marker to the composer', async () => {
  const harness = createWorkflowHarness({
    originalText:
      '<plan_revision_123456>Please revise the implementation plan at .tidecode/plans/plan-001.md using the review comments below.</plan_revision_123456>',
    streamOutcome: 'aborted',
  })

  try {
    const accepted = await persistAndStreamMessage(harness.input)

    assert.equal(accepted, true)
    assert.deepEqual(harness.history.getStoredMessages(harness.conversation.id), [], 'history must be rolled back')
    assert.deepEqual(harness.composerValues, [''], 'the revision marker must not return to the composer')
  } finally {
    harness.restoreWindow()
  }
})
