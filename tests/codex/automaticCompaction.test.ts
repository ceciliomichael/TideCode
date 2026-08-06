import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import {
  mergeAutomaticCompactionMessages,
  resolveAutomaticCompactionTrigger,
} from '../../electron/chat/shared/compaction/automatic'

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

test('automatic compaction budgets tool results supplied only through accumulated responses', () => {
  const messages: ModelMessage[] = [{ role: 'user', content: 'Inspect the workspace.' }]
  const mergedMessages = mergeAutomaticCompactionMessages({
    messages,
    responseMessages: completedToolStep,
  })

  assert.deepEqual(mergedMessages, [...messages, ...completedToolStep])
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
