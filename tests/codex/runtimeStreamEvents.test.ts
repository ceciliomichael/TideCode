import assert from 'node:assert/strict'
import test from 'node:test'
import type { WebContents } from 'electron'
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
