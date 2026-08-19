import assert from 'node:assert/strict'
import test from 'node:test'
import { streamAssistantResponse } from '../../src/hooks/chatMessageRuntime'
import { DEFAULT_CONTEXT_COMPACTION_SETTINGS } from '../../src/lib/contextCompactionSettings'
import type { ChatStreamEvent, TideCodeRunEvent } from '../../src/types/chat'

test('shared run_state completion settles a stream when the raw terminal event is missed', async () => {
  const originalWindow = globalThis.window
  let chatListener: ((event: ChatStreamEvent) => void) | null = null
  let runListener: ((event: TideCodeRunEvent) => void) | null = null
  let startedStreamId: string | null = null

  const windowStub = {
    clearTimeout,
    setTimeout,
    tidecodeChat: {
      onStreamEvent: (listener: (event: ChatStreamEvent) => void) => {
        chatListener = listener
        return () => { chatListener = null }
      },
      startStream: async () => ({ streamId: 'stream-sync-test' }),
    },
    tidecodeRuns: {
      getRunByStreamId: async () => null,
      onEvent: (listener: (event: TideCodeRunEvent) => void) => {
        runListener = listener
        return () => { runListener = null }
      },
    },
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: windowStub,
    writable: true,
  })

  try {
    const responsePromise = streamAssistantResponse({
      agentContextRootPath: 'C:/workspace',
      cacheScopeId: 'conversation-sync-test',
      chatMode: 'agent',
      conversationId: 'conversation-sync-test',
      contextCompaction: DEFAULT_CONTEXT_COMPACTION_SETTINGS,
      messages: [],
      modelId: 'gpt-test',
      onCompactionCommitted: () => undefined,
      onContentDelta: () => undefined,
      onReasoningCompleted: () => undefined,
      onReasoningDelta: () => undefined,
      onSteerMessagesConsumed: () => undefined,
      onStreamStarted: (streamId) => { startedStreamId = streamId },
      onSyntheticToolMessage: () => undefined,
      onToolInvocationCompleted: () => undefined,
      onToolInvocationDecisionRequested: () => undefined,
      onToolInvocationDelta: () => undefined,
      onToolInvocationFailed: () => undefined,
      onToolInvocationStarted: () => undefined,
      providerId: 'codex',
      reasoningEffort: 'medium',
      terminalExecutionMode: 'auto',
    })

    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(startedStreamId, 'stream-sync-test')
    assert.ok(chatListener)
    assert.ok(runListener)

    runListener({
      seq: 7,
      type: 'run_state',
      run: {
        contextUsage: null,
        conversationId: 'conversation-sync-test',
        lastEventSeq: 7,
        modelId: 'gpt-test',
        projectionRevision: 4,
        providerId: 'codex',
        runId: 'run-sync-test',
        startedAt: 1,
        status: 'completed',
        streamId: 'stream-sync-test',
        updatedAt: 2,
        workspaceRootPath: 'C:/workspace',
      },
    })

    assert.deepEqual(await responsePromise, { wasAborted: false })
    assert.equal(chatListener, null)
    assert.equal(runListener, null)
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
      writable: true,
    })
  }
})
