import assert from 'node:assert/strict'
import test from 'node:test'
import { SharedRunRegistry } from '../electron/runService/runRegistry'

function createRunInput(conversationId: string) {
  return {
    agentContextRootPath: 'C:/workspace',
    chatMode: 'agent',
    conversationId,
    messages: [],
    modelId: 'test-model',
    providerId: 'codex',
    reasoningEffort: 'medium',
    terminalExecutionMode: 'sandbox',
  } as Parameters<SharedRunRegistry['create']>[0]
}

test('removing a provisional run releases the conversation for an immediate retry', () => {
  const registry = new SharedRunRegistry()
  const firstRun = registry.create(createRunInput('conversation-1'))

  assert.throws(
    () => registry.create(createRunInput('conversation-1')),
    /already active/u,
  )

  registry.remove(firstRun.runId)
  const retryRun = registry.create(createRunInput('conversation-1'))

  assert.notEqual(retryRun.runId, firstRun.runId)
  assert.equal(retryRun.status, 'starting')
  assert.deepEqual(registry.listActive().map((run) => run.runId), [retryRun.runId])
})
