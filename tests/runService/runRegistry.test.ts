import assert from 'node:assert/strict'
import test from 'node:test'
import { SharedRunRegistry } from '../../electron/runService/runRegistry'
import type { StartChatStreamInput } from '../../src/types/chat'

function createInput(conversationId = 'conversation-1'): StartChatStreamInput & { conversationId: string } {
  return {
    agentContextRootPath: 'C:/workspace',
    chatMode: 'agent',
    contextCompaction: {
      enabled: true,
      reserveTokens: 4096,
      thresholdPercent: 80,
    },
    conversationId,
    messages: [],
    modelId: 'test-model',
    providerId: 'codex',
    reasoningEffort: 'medium',
    terminalExecutionMode: 'sandboxed',
  }
}

test('registry allows only one active shared run per conversation', () => {
  const registry = new SharedRunRegistry()
  registry.create(createInput())
  assert.throws(() => registry.create(createInput()), /already active/i)
})

test('terminal runs no longer block a new run for the same conversation', () => {
  const registry = new SharedRunRegistry()
  const first = registry.create(createInput())
  registry.updateStatus(first.runId, 'completed')
  const second = registry.create(createInput())
  assert.notEqual(first.runId, second.runId)
})

test('stream ids resolve to the owning provider and active run', () => {
  const registry = new SharedRunRegistry()
  const run = registry.create(createInput())
  const attached = registry.attachStream(run.runId, 'stream-1')
  assert.equal(attached.status, 'running')
  assert.equal(registry.getProviderByStreamId('stream-1'), 'codex')
  assert.equal(registry.getByStreamId('stream-1')?.conversationId, 'conversation-1')
  assert.deepEqual(registry.listActive().map((entry) => entry.runId), [run.runId])
})

test('active runs retain the latest live context usage for reconnecting clients', () => {
  const registry = new SharedRunRegistry()
  const run = registry.create(createInput())
  registry.attachStream(run.runId, 'stream-1')
  registry.updateContextUsage(run.runId, {
    historyTokens: 42_000,
    maxTokens: 200_000,
    systemPromptTokens: 5_000,
    toolResultsTokens: 80_000,
    totalTokens: 127_000,
  })

  assert.deepEqual(registry.listActive()[0]?.contextUsage, {
    historyTokens: 42_000,
    maxTokens: 200_000,
    systemPromptTokens: 5_000,
    toolResultsTokens: 80_000,
    totalTokens: 127_000,
  })
})
