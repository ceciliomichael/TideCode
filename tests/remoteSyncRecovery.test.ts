import assert from 'node:assert/strict'
import test from 'node:test'
import { streamAssistantResponse } from '../src/hooks/chatMessageRuntime'

type StreamInput = Parameters<typeof streamAssistantResponse>[0]

function installRemoteStreamHarness(activeStreams: Set<string>) {
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const browser = new EventTarget() as Window & typeof globalThis
  const documentStub = new EventTarget() as Document
  Object.assign(documentStub, {
    visibilityState: 'visible',
    documentElement: { dataset: { tidecodeRuntime: 'remote-browser' } },
  })
  let streamListener: ((event: unknown) => void) | null = null
  Object.assign(browser, {
    tidecodeChat: {
      onStreamEvent: (listener: (event: unknown) => void) => {
        streamListener = listener
        return () => { streamListener = null }
      },
      startStream: async () => ({ streamId: 'stream-1' }),
    },
    tidecodeRuns: {
      listActiveRuns: async () => [...activeStreams].map((streamId) => ({ streamId })),
    },
  })
  globalThis.window = browser
  globalThis.document = documentStub
  const noop = () => undefined
  const input = {
    processStreamEvents: false,
    onStreamStarted: noop,
    onContentDelta: noop,
    onReasoningCompleted: noop,
    onReasoningDelta: noop,
    onCompactionCommitted: noop,
    onSteerMessagesConsumed: noop,
    onSyntheticToolMessage: noop,
    onToolInvocationCompleted: noop,
    onToolInvocationFailed: noop,
    onToolInvocationStarted: noop,
    onToolInvocationDelta: noop,
    onToolInvocationDecisionRequested: noop,
  } as unknown as StreamInput
  return {
    browser,
    input,
    emit: (event: unknown) => streamListener?.(event),
    restore: () => {
      globalThis.window = previousWindow
      globalThis.document = previousDocument
    },
  }
}

test('remote stream recovers a completion missed while disconnected', async () => {
  const harness = installRemoteStreamHarness(new Set())
  try {
    const result = streamAssistantResponse(harness.input)
    await Promise.resolve()
    harness.browser.dispatchEvent(new Event('tidecode:remote-reconnected'))
    assert.deepEqual(await result, { hadMeaningfulOutput: true, wasAborted: false })
  } finally {
    harness.restore()
  }
})

test('remote stream does not finish while its host run remains active', async () => {
  const activeStreams = new Set(['stream-1'])
  const harness = installRemoteStreamHarness(activeStreams)
  try {
    let completed = false
    const result = streamAssistantResponse(harness.input).then((value) => {
      completed = true
      return value
    })
    await Promise.resolve()
    harness.browser.dispatchEvent(new Event('tidecode:remote-reconnected'))
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(completed, false)
    harness.emit({ streamId: 'stream-1', type: 'completed' })
    assert.deepEqual(await result, { hadMeaningfulOutput: false, wasAborted: false })
  } finally {
    harness.restore()
  }
})
