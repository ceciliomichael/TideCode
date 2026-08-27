import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import type { ProviderStepRecord } from '../../electron/chat/history/contracts'
import { runProviderToolContinuationLoop } from '../../electron/chat/shared/runtimeToolContinuation'

function createCodeModeStep(stepNumber = 0): ProviderStepRecord {
  return {
    durationMs: 1,
    finishReason: 'tool-calls',
    providerMetadata: null,
    responseMessages: [
      {
        role: 'assistant',
        content: [{
          input: 'return await tools.read({ path: "AGENTS.md", full_file: true })',
          toolCallId: 'call-1',
          toolName: 'code_mode',
          type: 'tool-call',
        }],
      },
      {
        role: 'tool',
        content: [{
          output: { type: 'text', value: 'Code Mode completed' },
          toolCallId: 'call-1',
          toolName: 'code_mode',
          type: 'tool-result',
        }],
      },
    ],
    stepNumber,
    usage: {
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputTokens: 1,
      noCacheTokens: 1,
      outputTokens: 1,
      reasoningTokens: 0,
      totalTokens: 2,
    },
  }
}

const initialMessages: ModelMessage[] = [{ role: 'user', content: 'Read the instructions and continue.' }]

test('restarts after a completed Code Mode boundary with the same cache key and completed tool context', async () => {
  const calls: Array<{ cacheKey: string; messages: ModelMessage[]; continuationIndex: number }> = []
  let continuationMessages = [...initialMessages]

  const result = await runProviderToolContinuationLoop({
    getContinuationMessages: () => continuationMessages,
    initialInput: {
      cacheKey: 'stable-cache-key',
      messages: initialMessages,
    },
    run: async (streamInput, continuationIndex) => {
      calls.push({
        cacheKey: streamInput.cacheKey,
        continuationIndex,
        messages: [...streamInput.messages],
      })

      if (continuationIndex === 0) {
        const lastStep = createCodeModeStep()
        continuationMessages = [
          ...initialMessages,
          ...(lastStep.responseMessages as ModelMessage[]),
        ]
        return { lastFinishReason: null, lastStep, wasAborted: false }
      }

      const lastStep = {
        ...createCodeModeStep(1),
        finishReason: 'stop',
        responseMessages: [{ role: 'assistant', content: 'Done.' }],
      }
      return { lastFinishReason: 'stop', lastStep, wasAborted: false }
    },
  })

  assert.equal(result.lastFinishReason, 'stop')
  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map((call) => call.cacheKey), ['stable-cache-key', 'stable-cache-key'])
  assert.equal(calls[1]?.continuationIndex, 1)
  assert.equal(calls[1]?.messages.some((message) => message.role === 'tool'), true)
  assert.equal(calls[1]?.messages.length, 3)
})

test('continues when the outer stream says stop but the completed provider step says tool-calls', async () => {
  let callCount = 0
  const firstStep = createCodeModeStep()
  let continuationMessages = [
    ...initialMessages,
    ...(firstStep.responseMessages as ModelMessage[]),
  ]

  const result = await runProviderToolContinuationLoop({
    getContinuationMessages: () => continuationMessages,
    initialInput: { cacheKey: 'key', messages: initialMessages },
    run: async (_streamInput, continuationIndex) => {
      callCount += 1
      if (continuationIndex === 0) {
        return { lastFinishReason: 'stop', lastStep: firstStep, wasAborted: false }
      }

      const lastStep = {
        ...createCodeModeStep(1),
        finishReason: 'stop',
        responseMessages: [{ role: 'assistant', content: 'Done.' }],
      }
      continuationMessages = [...continuationMessages, ...(lastStep.responseMessages as ModelMessage[])]
      return { lastFinishReason: 'stop', lastStep, wasAborted: false }
    },
  })

  assert.equal(result.lastFinishReason, 'stop')
  assert.equal(callCount, 2)
})

test('does not let an outer tool-calls signal override a completed provider stop step', async () => {
  let callCount = 0
  const stoppedStep: ProviderStepRecord = {
    ...createCodeModeStep(),
    finishReason: 'stop',
  }

  const result = await runProviderToolContinuationLoop({
    getContinuationMessages: () => [
      ...initialMessages,
      ...(stoppedStep.responseMessages as ModelMessage[]),
    ],
    initialInput: { cacheKey: 'key', messages: initialMessages },
    run: async () => {
      callCount += 1
      return { lastFinishReason: 'tool-calls', lastStep: stoppedStep, wasAborted: false }
    },
  })

  assert.equal(result.lastFinishReason, 'tool-calls')
  assert.equal(callCount, 1)
})

test('does not restart after a normal model stop', async () => {
  let callCount = 0
  const result = await runProviderToolContinuationLoop({
    getContinuationMessages: () => initialMessages,
    initialInput: { cacheKey: 'key', messages: initialMessages },
    run: async () => {
      callCount += 1
      return { lastFinishReason: 'stop', lastStep: null, wasAborted: false }
    },
  })

  assert.equal(result.lastFinishReason, 'stop')
  assert.equal(callCount, 1)
})

test('does not restart an aborted Code Mode boundary', async () => {
  let callCount = 0
  const step = createCodeModeStep()
  const result = await runProviderToolContinuationLoop({
    getContinuationMessages: () => [
      ...initialMessages,
      ...(step.responseMessages as ModelMessage[]),
    ],
    initialInput: { cacheKey: 'key', messages: initialMessages },
    run: async () => {
      callCount += 1
      return { lastFinishReason: 'tool-calls', lastStep: step, wasAborted: true }
    },
  })

  assert.equal(result.wasAborted, true)
  assert.equal(callCount, 1)
})

test('does not restart a tool-calls finish without a completed Code Mode result', async () => {
  let callCount = 0
  const stepWithoutResult: ProviderStepRecord = {
    ...createCodeModeStep(),
    responseMessages: [{ role: 'assistant', content: 'No tool result.' }],
  }
  const result = await runProviderToolContinuationLoop({
    getContinuationMessages: () => initialMessages,
    initialInput: { cacheKey: 'key', messages: initialMessages },
    run: async () => {
      callCount += 1
      return { lastFinishReason: 'tool-calls', lastStep: stepWithoutResult, wasAborted: false }
    },
  })

  assert.equal(result.lastFinishReason, 'tool-calls')
  assert.equal(callCount, 1)
})
