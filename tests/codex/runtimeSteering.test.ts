import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSameTurnSteerModelMessages,
  createSameTurnSteerMessages,
  hasCompletedToolBoundary,
} from '../../electron/chat/shared/runtimeSteering'
import type { StartChatStreamInput } from '../../src/types/chat'

const startInput: StartChatStreamInput = {
  agentContextRootPath: 'C:\\workspace',
  chatMode: 'agent',
  contextCompaction: {
    contextWindowTokens: 128_000,
    triggerPercent: 80,
  },
  conversationId: 'conversation-1',
  messages: [],
  modelId: 'test-model',
  providerId: 'custom:test',
  reasoningEffort: 'none',
  terminalExecutionMode: 'sandbox',
}

test('steering opens only after a completed tool-result boundary', () => {
  assert.equal(hasCompletedToolBoundary([]), false)
  assert.equal(hasCompletedToolBoundary([{ toolResults: [] }]), false)
  assert.equal(hasCompletedToolBoundary([{ toolResults: [{}] }]), true)
})

test('steer messages become user messages without creating a new run checkpoint', () => {
  const messages = createSameTurnSteerMessages([
    { content: 'first steer', id: 'steer-1', timestamp: 10 },
    { content: 'second steer', id: 'steer-2', timestamp: 11 },
  ], startInput)

  assert.deepEqual(messages.map((message) => message.id), ['steer-1', 'steer-2'])
  assert.equal(messages.every((message) => message.role === 'user'), true)
  assert.equal(messages.every((message) => message.userMessageKind === 'steer'), true)
  assert.equal(messages.every((message) => message.runCheckpoint === undefined), true)
  assert.deepEqual(
    buildSameTurnSteerModelMessages(messages, {}).map((message) => message.role),
    ['user', 'user'],
  )
})
