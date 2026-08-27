import assert from 'node:assert/strict'
import test from 'node:test'
import type { WebContents } from 'electron'
import { parseStructuredToolResultContent } from '../../src/lib/toolResultContent'
import {
  processRuntimeStream,
  type RuntimeStreamPart,
} from '../../electron/chat/shared/runtimeStreamEvents'

function createWebContentsStub(events: unknown[]) {
  return {
    isDestroyed: () => false,
    send: (_channel: string, event: unknown) => {
      events.push(event)
    },
  } as unknown as WebContents
}

async function* createRuntimeStream(parts: readonly RuntimeStreamPart[]) {
  for (const part of parts) {
    yield part
  }
}

test('a normally closed stream reports an abort when the signal was cancelled', async () => {
  const controller = new AbortController()
  controller.abort()
  const events: unknown[] = []

  const result = await processRuntimeStream({
    abortController: controller,
    conversationId: null,
    fullStream: createRuntimeStream([{ finishReason: 'stop', type: 'finish' }]),
    queueHistoryWrite: () => undefined,
    streamId: 'stream-1',
    webContents: createWebContentsStub(events),
  })

  assert.equal(result.wasAborted, true)
})

test('a normally completed stream is not marked aborted', async () => {
  const controller = new AbortController()
  const events: unknown[] = []

  const result = await processRuntimeStream({
    abortController: controller,
    conversationId: null,
    fullStream: createRuntimeStream([{ finishReason: 'stop', type: 'finish' }]),
    queueHistoryWrite: () => undefined,
    streamId: 'stream-2',
    webContents: createWebContentsStub(events),
  })

  assert.equal(result.wasAborted, false)
})

test('a provider error stream part rejects instead of completing successfully', async () => {
  const controller = new AbortController()
  const events: unknown[] = []

  await assert.rejects(
    processRuntimeStream({
      abortController: controller,
      conversationId: null,
      fullStream: createRuntimeStream([
        { error: new Error('Codex continuation rejected'), type: 'error' },
      ]),
      queueHistoryWrite: () => undefined,
      streamId: 'stream-provider-error',
      webContents: createWebContentsStub(events),
    }),
    /Codex continuation rejected/u,
  )
})

test('reasoning deltas and completion are forwarded to the renderer', async () => {
  const controller = new AbortController()
  const events: unknown[] = []

  const result = await processRuntimeStream({
    abortController: controller,
    conversationId: null,
    fullStream: createRuntimeStream([
      { id: 'reasoning-1', type: 'reasoning-start' },
      { id: 'reasoning-1', text: 'Inspecting the repository.', type: 'reasoning-delta' },
      { id: 'reasoning-1', type: 'reasoning-end' },
      { finishReason: 'stop', type: 'finish' },
    ]),
    queueHistoryWrite: () => undefined,
    streamId: 'stream-reasoning',
    webContents: createWebContentsStub(events),
  })

  assert.deepEqual(events, [
    { delta: 'Inspecting the repository.', streamId: 'stream-reasoning', type: 'reasoning_delta' },
    { streamId: 'stream-reasoning', type: 'reasoning_completed' },
  ])
  assert.equal(result.wasAborted, false)
})

test('an aborted stream ignores late provider events while the tool unwinds', async () => {
  const controller = new AbortController()
  const events: unknown[] = []
  let hasEmittedBeforeAbort = false

  async function* createLateRuntimeStream() {
    yield { text: 'before cancellation', type: 'text-delta' }
    hasEmittedBeforeAbort = true
    controller.abort()
    yield { text: 'after cancellation', type: 'text-delta' }
    yield { finishReason: 'stop', type: 'finish' }
  }

  const result = await processRuntimeStream({
    abortController: controller,
    conversationId: null,
    fullStream: createLateRuntimeStream(),
    queueHistoryWrite: () => undefined,
    streamId: 'stream-3',
    webContents: createWebContentsStub(events),
  })

  assert.equal(hasEmittedBeforeAbort, true)
  assert.deepEqual(events, [{ delta: 'before cancellation', streamId: 'stream-3', type: 'content_delta' }])
  assert.equal(result.wasAborted, true)
})

test('an aborted partial tool request is reported as cancelled before execution', async () => {
  const controller = new AbortController()
  const events: unknown[] = []

  async function* createAbortedToolStream() {
    yield { id: 'tool-call-1', toolName: 'execute_terminal', type: 'tool-input-start' }
    yield { delta: '{"command":"npm run lint"}', id: 'tool-call-1', type: 'tool-input-delta' }
    controller.abort()
    yield {
      input: { command: 'npm run lint' },
      output: { body: 'late output', status: 'success', summary: 'Completed execute_terminal' },
      toolCallId: 'tool-call-1',
      toolName: 'execute_terminal',
      type: 'tool-result',
    }
  }

  const result = await processRuntimeStream({
    abortController: controller,
    conversationId: null,
    fullStream: createAbortedToolStream(),
    queueHistoryWrite: () => undefined,
    streamId: 'stream-terminated-tool',
    webContents: createWebContentsStub(events),
  })

  const terminatedEvent = events.at(-1) as {
    errorMessage?: string
    resultContent?: string
    syntheticMessage?: { role?: string; toolCallId?: string }
    type?: string
  }
  const parsedResult = parseStructuredToolResultContent(terminatedEvent.resultContent ?? '')

  assert.equal(result.wasAborted, true)
  assert.equal(terminatedEvent.type, 'tool_invocation_failed')
  assert.equal(terminatedEvent.errorMessage, 'Tool request cancelled before execution')
  assert.equal(parsedResult.body, 'Tool request cancelled before execution')
  assert.equal(parsedResult.metadata?.summary, 'Tool request cancelled before execution')
  assert.equal(parsedResult.metadata?.status, 'error')
  assert.equal(terminatedEvent.syntheticMessage?.role, 'tool')
  assert.equal(terminatedEvent.syntheticMessage?.toolCallId, 'tool-call-1')
})

test('an aborted accepted tool call is reported as terminated during execution', async () => {
  const controller = new AbortController()
  const events: unknown[] = []

  async function* createAbortedToolStream() {
    yield {
      input: { command: 'npm run lint' },
      toolCallId: 'tool-call-accepted',
      toolName: 'execute_terminal',
      type: 'tool-call',
    }
    controller.abort()
  }

  await processRuntimeStream({
    abortController: controller,
    conversationId: null,
    fullStream: createAbortedToolStream(),
    queueHistoryWrite: () => undefined,
    streamId: 'stream-accepted-tool',
    webContents: createWebContentsStub(events),
  })

  const terminatedEvent = events.at(-1) as { errorMessage?: string; resultContent?: string; type?: string }
  const parsedResult = parseStructuredToolResultContent(terminatedEvent.resultContent ?? '')
  assert.equal(terminatedEvent.type, 'tool_invocation_failed')
  assert.equal(terminatedEvent.errorMessage, 'Tool execution terminated')
  assert.equal(parsedResult.body, 'Tool execution terminated')
})
