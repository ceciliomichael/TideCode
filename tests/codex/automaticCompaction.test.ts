import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import { resolveAutomaticCompactionTrigger } from '../../electron/chat/shared/compaction/automatic'

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

test('automatic compaction does not run for a non-tool continuation', () => {
  assert.equal(resolveAutomaticCompactionTrigger({
    messages: [{ role: 'assistant', content: 'Continue.' }],
    responseMessages: [{ role: 'assistant', content: 'Continue.' }],
    stepNumber: 1,
  }), null)
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
