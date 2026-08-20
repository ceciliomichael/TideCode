import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import {
  resolveAutomaticCompactionMessages,
  resolveAutomaticCompactionTrigger,
} from '../../electron/chat/shared/compaction/automatic'
import {
  calculateModelMessagesBudget,
  shouldCompactContext,
} from '../../electron/chat/shared/compaction/budget'

const completedToolStep: ModelMessage[] = [
  {
    role: 'assistant',
    content: [{
      input: { path: 'src/app.ts' },
      toolCallId: 'call-1',
      toolName: 'read_file',
      type: 'tool-call',
    }],
  },
  {
    role: 'tool',
    content: [{
      output: { type: 'text', value: 'file contents' },
      toolCallId: 'call-1',
      toolName: 'read_file',
      type: 'tool-result',
    }],
  },
]

test('automatic compaction is eligible before a new user turn', () => {
  assert.equal(resolveAutomaticCompactionTrigger({
    messages: [{ role: 'user', content: 'Continue the task.' }],
    responseMessages: [],
    stepNumber: 0,
  }), 'user_turn')
})

test('automatic compaction is eligible after a completed tool result', () => {
  assert.equal(resolveAutomaticCompactionTrigger({
    messages: completedToolStep,
    responseMessages: completedToolStep,
    stepNumber: 1,
  }), 'tool_result')
})

test('automatic compaction remains eligible for a non-tool continuation boundary', () => {
  assert.equal(resolveAutomaticCompactionTrigger({
    messages: [{ role: 'assistant', content: 'Continue.' }],
    responseMessages: [{ role: 'assistant', content: 'Continue.' }],
    stepNumber: 1,
  }), 'model_step')
})

test('automatic compaction detects a tool result even when a provider appends a message', () => {
  const messages = [
    ...completedToolStep,
    { role: 'assistant', content: 'I am continuing after the tool result.' } satisfies ModelMessage,
  ]

  assert.equal(resolveAutomaticCompactionTrigger({
    messages,
    responseMessages: messages,
    stepNumber: 1,
  }), 'tool_result')
})

test('automatic compaction uses the exact AI SDK current-step message state', () => {
  const currentStepMessages: ModelMessage[] = [
    { role: 'user', content: 'Inspect the workspace.' },
    ...completedToolStep,
  ]

  assert.deepEqual(
    resolveAutomaticCompactionMessages({
      messages: currentStepMessages,
      responseMessages: completedToolStep,
    }),
    currentStepMessages,
  )
})

test('automatic compaction does not cross the threshold by re-appending accumulated responses', () => {
  const currentStepMessages: ModelMessage[] = [
    { role: 'user', content: 'H'.repeat(600_000) },
  ]
  const accumulatedResponses: ModelMessage[] = [
    { role: 'assistant', content: 'R'.repeat(80_000) },
  ]
  const providerMessages = resolveAutomaticCompactionMessages({
    messages: currentStepMessages,
    responseMessages: accumulatedResponses,
  })
  const actualBudget = calculateModelMessagesBudget({
    contextWindowTokens: 200_000,
    messages: providerMessages,
    systemPromptTokens: 0,
    toolSchemaTokens: 0,
    triggerRatio: 0.8,
  })
  const incorrectlyInflatedBudget = calculateModelMessagesBudget({
    contextWindowTokens: 200_000,
    messages: [...providerMessages, ...accumulatedResponses],
    systemPromptTokens: 0,
    toolSchemaTokens: 0,
    triggerRatio: 0.8,
  })

  assert.deepEqual(providerMessages, currentStepMessages)
  assert.equal(shouldCompactContext(actualBudget), false)
  assert.equal(shouldCompactContext(incorrectlyInflatedBudget), true)
})

test('automatic compaction does not resurrect response history removed by a persisted message override', () => {
  const compactedMessages: ModelMessage[] = [
    { role: 'user', content: 'Continue the task.' },
    { role: 'assistant', content: 'Compacted continuation state.' },
  ]
  const preCompactionResponses: ModelMessage[] = [
    { role: 'assistant', content: 'A large historical response.' },
    ...completedToolStep,
  ]

  assert.deepEqual(
    resolveAutomaticCompactionMessages({
      messages: compactedMessages,
      responseMessages: preCompactionResponses,
    }),
    compactedMessages,
  )
})

test('automatic compaction is cancelled when the run is aborted', () => {
  const controller = new AbortController()
  controller.abort()

  assert.equal(resolveAutomaticCompactionTrigger({
    abortSignal: controller.signal,
    messages: completedToolStep,
    responseMessages: completedToolStep,
    stepNumber: 1,
  }), null)
})
