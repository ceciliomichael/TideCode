import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { useChatSendActions } from '../../src/hooks/useChatSendActions'
import type { ConversationRecord, Message } from '../../src/types/chat'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}

async function waitUntil(predicate: () => boolean) {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'message operation did not reach the expected state')
    await new Promise(resolve => setTimeout(resolve, 1))
  }
}

function createHarness() {
  type Input = Parameters<typeof useChatSendActions>[0]
  const records = new Map<string, ConversationRecord>()
  type StreamEvent = Parameters<Parameters<Window['tidecodeChat']['onStreamEvent']>[0]>[0]
  const listeners = new Set<(event: StreamEvent) => void>()
  const streams = new Map<string, string>()
  const cancelled: string[] = []
  const errors: string[] = []
  const checkpoints: ReturnType<typeof deferred>[] = []
  const pendingDrafts = new Set<string>()
  let checkpointCalls = 0
  let composerRevision = 0
  let optimisticDraft: { scope: string; messages: Message[] } | null = null
  let editingMessageId: string | null = null
  const activeConversationIdRef = { current: null as string | null }
  const draftAttachmentScopeIdRef = { current: 'draft-a' }
  const runtime = { current: {} as Input['conversationRuntimeStatesRef']['current'] }
  const upsert = (conversation: ConversationRecord) => {
    const previous = runtime.current[conversation.id]
    runtime.current[conversation.id] = {
      activeStreamId: null,
      isSending: false,
      ...previous,
      conversation,
    }
  }
  const replace = async ({ conversationId, messages }: { conversationId: string; messages: Message[] }) => {
    const record = records.get(conversationId)
    if (!record) {
      throw new Error(`Conversation not found: ${conversationId}`)
    }
    const next = { ...record, messages }
    records.set(conversationId, next)
    return next
  }
  const emit = (streamId: string, type: string, payload = {}) => {
    for (const listener of listeners) {
      listener({ streamId, type, ...payload } as StreamEvent)
    }
  }
  const input: Input = {
    activeConversationId: null,
    activeConversationIdRef,
    draftAttachmentScopeId: 'draft-a',
    draftAttachmentScopeIdRef,
    selectedFolderId: 'project-1',
    selectedFolderIdRef: { current: 'project-1' },
    conversationRuntimeStatesRef: runtime,
    draftChatMode: 'agent',
    mainComposerValue: '',
    mainComposerAttachments: [],
    editComposerValue: '',
    editComposerAttachments: [],
    editingMessageId: null,
    pendingDraftSendCount: 0,
    applyConversation: conversation => {
      upsert(conversation)
      activeConversationIdRef.current = conversation.id
      input.activeConversationId = conversation.id
    },
    upsertConversation: upsert,
    updateConversationRuntimeState: (id, patch) => {
      if (runtime.current[id]) {
        Object.assign(runtime.current[id], patch)
      }
    },
    updateConversationSummary: () => {},
    appendLocalMessage: (id, message) => {
      runtime.current[id].conversation.messages.push(message)
    },
    removeLocalMessage: (id, messageId) => {
      runtime.current[id].conversation = {
        ...runtime.current[id].conversation,
        messages: runtime.current[id].conversation.messages.filter(message => message.id !== messageId),
      }
    },
    replaceLocalMessages: (id, messages) => {
      const conversation = runtime.current[id].conversation
      runtime.current[id].conversation = {
        ...conversation,
        messages: typeof messages === 'function' ? messages(conversation.messages) : messages,
      }
    },
    updateLocalMessage: (id, messageId, update) => {
      const conversation = runtime.current[id].conversation
      runtime.current[id].conversation = {
        ...conversation,
        messages: conversation.messages.map(message => message.id === messageId ? update(message) : message),
      }
    },
    clearError: () => {},
    setError: error => {
      if (error) {
        errors.push(error)
      }
    },
    setMainComposerValue: value => {
      input.mainComposerValue = value
      composerRevision += 1
    },
    getMainComposerRevision: () => composerRevision,
    setMainComposerAttachments: () => {},
    setMainComposerMentionPathMap: () => {},
    setDraftSendPending: (scope, pending) => {
      if (pending) {
        pendingDrafts.add(scope)
      } else {
        pendingDrafts.delete(scope)
      }
      input.pendingDraftSendCount = pendingDrafts.has(draftAttachmentScopeIdRef.current) ? 1 : 0
    },
    setOptimisticDraftMessages: (messages, scope) => {
      if (messages.length > 0) {
        optimisticDraft = { scope, messages }
      } else if (optimisticDraft?.scope === scope) {
        optimisticDraft = null
      }
    },
    beginHistoryCutoff: () => {},
    clearHistoryCutoff: () => {},
    beginOptimisticEditedPresentation: () => {},
    clearOptimisticEditedPresentation: () => {},
    beginPendingRevertEditingMessage: () => {},
    beginRevertEditingMessage: (_id, messageId) => {
      editingMessageId = messageId
    },
    cancelEditingMessage: () => {},
    completeEditingMessage: () => {},
    clearTextStreamingIdleTimeout: () => {},
    markTextStreamingPulse: () => {},
    stopTextStreaming: () => {},
  }
  const globalScope = globalThis as unknown as { window: unknown; document: unknown }
  const previousWindow = globalScope.window
  const previousDocument = globalScope.document
  globalScope.document = { documentElement: { dataset: {} }, removeEventListener: () => {} }
  globalScope.window = {
    setTimeout,
    clearTimeout,
    removeEventListener: () => {},
    tidecodeHistory: {
      createConversation: async () => {
        const id = `chat-${records.size + 1}`
        const record: ConversationRecord = {
          id, folderId: 'project-1', agentContextRootPath: '/project-1',
          chatMode: 'agent', title: 'New Chat', createdAt: 1, updatedAt: 1, messages: [],
        }
        records.set(id, record)
        return record
      },
      getConversation: async (id: string) => records.get(id) ?? null,
      replaceMessages: replace,
      appendMessages: async (request: { conversationId: string; messages: Message[] }) => {
        const record = records.get(request.conversationId)!
        return replace({ ...request, messages: [...record.messages, ...request.messages] })
      },
    },
    tidecodeWorkspace: {
      createCheckpoint: async () => {
        const index = checkpointCalls++
        await checkpoints[index]?.promise
        return { id: `checkpoint-${index}`, createdAt: 1 }
      },
      createRedoCheckpointFromSources: async () => ({ id: 'redo-1', createdAt: 1 }),
      restoreCheckpointSequence: async () => {},
    },
    tidecodeChat: {
      onStreamEvent: (listener: (event: StreamEvent) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      startStream: async ({ conversationId }: { conversationId: string }) => {
        const streamId = `stream-${streams.size + 1}`
        streams.set(streamId, conversationId)
        return { streamId }
      },
      cancelStream: async (streamId: string) => {
        cancelled.push(streamId)
        emit(streamId, 'aborted')
      },
    },
  }
  let actions!: ReturnType<typeof useChatSendActions>
  function Harness() {
    actions = useChatSendActions(input)
    return null
  }
  renderToString(createElement(Harness))
  const selection = {
    hasConfiguredProvider: true, providerId: 'codex', modelId: 'gpt-5', reasoningEffort: 'low',
    terminalExecutionMode: 'auto', contextCompaction: { enabled: false, threshold: 0 },
  } as Parameters<typeof actions.sendNewMessage>[0]
  return {
    actions, input, records, runtime, streams, cancelled, errors, checkpoints, emit,
    get checkpointCalls() { return checkpointCalls },
    get editingMessageId() { return editingMessageId },
    get optimisticDraft() { return optimisticDraft },
    send: (text: string) => actions.sendNewMessage(selection, text),
    newDraft: (scope: string) => {
      activeConversationIdRef.current = null
      input.activeConversationId = null
      input.draftAttachmentScopeId = scope
      draftAttachmentScopeIdRef.current = scope
      input.pendingDraftSendCount = pendingDrafts.has(scope) ? 1 : 0
    },
    restore: () => {
      globalScope.window = previousWindow
      globalScope.document = previousDocument
    },
  }
}

test('a second new chat sends and reverts while the first response is still running', async () => {
  const h = createHarness()
  try {
    const firstSend = h.send('First request')
    await waitUntil(() => h.runtime.current['chat-1']?.activeStreamId === 'stream-1')
    h.newDraft('draft-b')
    const secondSend = h.send('Second request')
    await waitUntil(() => h.runtime.current['chat-2']?.activeStreamId === 'stream-2')
    assert.equal(h.runtime.current['chat-1'].isSending, true)
    assert.equal((await h.send('Duplicate')).accepted, false)

    const messageId = h.records.get('chat-2')!.messages[0].id
    assert.equal(await h.actions.revertUserMessage(messageId), true)
    assert.deepEqual(h.cancelled, ['stream-2'])
    assert.deepEqual(h.records.get('chat-2')!.messages, [])
    assert.equal(h.runtime.current['chat-1'].isSending, true)
    assert.equal((await secondSend).accepted, true)

    const replacementSend = h.send('Second request revised')
    await waitUntil(() => h.runtime.current['chat-2']?.activeStreamId === 'stream-3')
    h.emit('stream-3', 'completed')
    assert.equal((await replacementSend).accepted, true)
    assert.deepEqual(h.records.get('chat-2')!.messages.map(message => message.content), ['Second request revised'])

    h.emit('stream-1', 'completed')
    assert.equal((await firstSend).accepted, true)
    assert.deepEqual(h.errors, [])
  } finally {
    h.restore()
  }
})

test('stopping a new draft during saving cannot stop another draft or steal its selection', async () => {
  const h = createHarness()
  const firstCheckpoint = deferred()
  const secondCheckpoint = deferred()
  h.checkpoints.push(firstCheckpoint, secondCheckpoint)
  try {
    const firstSend = h.send('First request')
    await waitUntil(() => h.checkpointCalls === 1)
    h.newDraft('draft-b')
    const secondSend = h.send('Second request')
    await waitUntil(() => h.checkpointCalls === 2)
    const stop = h.actions.abortStreamingResponse()
    firstCheckpoint.resolve()
    await waitUntil(() => h.runtime.current['chat-1']?.activeStreamId === 'stream-1')
    assert.equal(h.input.activeConversationIdRef.current, null)
    assert.equal(h.optimisticDraft?.scope, 'draft-b')
    assert.equal(h.input.pendingDraftSendCount, 1)

    secondCheckpoint.resolve()
    await stop
    assert.equal((await secondSend).accepted, true)
    assert.equal(h.streams.size, 1)
    assert.equal(h.runtime.current['chat-1'].isSending, true)
    assert.deepEqual(h.records.get('chat-2')!.messages, [])
    assert.deepEqual(h.cancelled, [])
    h.emit('stream-1', 'completed')
    await firstSend
    assert.deepEqual(h.errors, [])
  } finally {
    h.restore()
  }
})

test('reverting an optimistic message waits for saving before rolling back history', async () => {
  const h = createHarness()
  try {
    const initial = h.send('Initial request')
    await waitUntil(() => h.runtime.current['chat-1']?.activeStreamId === 'stream-1')
    h.emit('stream-1', 'completed')
    await initial

    const checkpoint = deferred()
    h.checkpoints.push(deferred(), checkpoint)
    const pendingSend = h.send('Revert before saving')
    const optimisticMessage = h.runtime.current['chat-1'].conversation.messages.at(-1)!
    await waitUntil(() => h.checkpointCalls === 2)
    const revert = h.actions.revertUserMessage(optimisticMessage.id)
    checkpoint.resolve()
    assert.equal(await revert, true)
    await pendingSend
    assert.ok(h.records.has('chat-1'))
    assert.equal(h.records.get('chat-1')!.messages.some(message => message.id === optimisticMessage.id), false)
    assert.equal(h.streams.size, 1)
    assert.deepEqual(h.errors, [])
  } finally {
    h.restore()
  }
})

test('reverting a completed saved response retains the conversation and prepares editing', async () => {
  const h = createHarness()
  try {
    const send = h.send('Saved request')
    await waitUntil(() => h.runtime.current['chat-1']?.activeStreamId === 'stream-1')
    h.emit('stream-1', 'content_delta', { delta: 'Saved response' })
    h.emit('stream-1', 'completed')
    await send
    const messageId = h.records.get('chat-1')!.messages[0].id
    assert.equal(await h.actions.revertUserMessage(messageId), true)
    assert.equal(h.editingMessageId, messageId)
    assert.ok(h.records.has('chat-1'))
    assert.deepEqual(h.errors, [])
  } finally {
    h.restore()
  }
})

test('overlapping stop requests cancel each selected chat independently', async () => {
  const h = createHarness()
  try {
    const firstSend = h.send('First request')
    await waitUntil(() => h.runtime.current['chat-1']?.activeStreamId === 'stream-1')
    h.newDraft('draft-b')
    const secondSend = h.send('Second request')
    await waitUntil(() => h.runtime.current['chat-2']?.activeStreamId === 'stream-2')

    const stopSecond = h.actions.abortStreamingResponse()
    h.input.activeConversationIdRef.current = 'chat-1'
    h.input.activeConversationId = 'chat-1'
    const stopFirst = h.actions.abortStreamingResponse()
    await Promise.all([stopSecond, stopFirst, firstSend, secondSend])

    assert.deepEqual(h.cancelled, ['stream-2', 'stream-1'])
    assert.deepEqual(h.records.get('chat-1')!.messages, [])
    assert.deepEqual(h.records.get('chat-2')!.messages, [])
    assert.deepEqual(h.errors, [])
  } finally {
    h.restore()
  }
})

test('stop in an idle new draft leaves another running chat alone', async () => {
  const h = createHarness()
  try {
    const send = h.send('Keep running')
    await waitUntil(() => h.runtime.current['chat-1']?.activeStreamId === 'stream-1')
    h.newDraft('draft-b')
    await h.actions.abortStreamingResponse()

    assert.deepEqual(h.cancelled, [])
    assert.equal(h.runtime.current['chat-1'].isSending, true)
    assert.equal(h.input.activeConversationIdRef.current, null)
    h.emit('stream-1', 'completed')
    await send
    assert.deepEqual(h.errors, [])
  } finally {
    h.restore()
  }
})
