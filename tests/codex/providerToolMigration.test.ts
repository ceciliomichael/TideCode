import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import { createEmptyCanonicalHistory } from '../../electron/chat/history/contracts'
import { projectCanonicalReplay } from '../../electron/chat/history/replayProjector'
import { shouldMigrateCrossProviderHistoryToText } from '../../electron/chat/history/providerSwitch'
import { migrateToolHistoryToUserInput } from '../../electron/chat/history/providerToolMigration'

test('detects a prior non-Codex provider from canonical run history', () => {
  const document = createEmptyCanonicalHistory('conversation', 1)
  document.events.push({
    anchorUserMessageId: 'user-1',
    branchId: 'main',
    contextFingerprint: 'openai-context',
    createdAt: 2,
    eventId: 'run-openai',
    fidelity: 'exact',
    initialMessages: [],
    modelId: 'gpt-5',
    providerId: 'openai',
    revision: 1,
    runId: 'run-openai',
    type: 'run_started',
  })

  assert.equal(shouldMigrateCrossProviderHistoryToText({
    document,
    messages: [{ content: 'Continue', id: 'user-2', providerId: 'codex', role: 'user', timestamp: 3 }],
    targetProviderId: 'codex',
  }), true)
  assert.equal(shouldMigrateCrossProviderHistoryToText({
    document,
    messages: [],
    targetProviderId: 'openai',
  }), false)
})

test('converts prior-provider tool exchanges to user input without leaving tool roles', () => {
  const messages = [
    { content: 'Inspect the workspace', role: 'user' },
    {
      content: [
        { text: 'I will inspect it.', type: 'text' },
        { input: { path: 'src/main.ts' }, toolCallId: 'call-old', toolName: 'read', type: 'tool-call' },
      ],
      role: 'assistant',
    },
    {
      content: [{ output: { type: 'text', value: 'export const answer = 42' }, toolCallId: 'call-old', toolName: 'read', type: 'tool-result' }],
      role: 'tool',
    },
    { content: 'Now explain it.', role: 'user' },
  ] as ModelMessage[]

  const migrated = migrateToolHistoryToUserInput(messages)
  assert.deepEqual(migrated.map((message) => message.role), ['user', 'assistant', 'user', 'user'])
  assert.equal(migrated.some((message) => message.role === 'tool'), false)
  assert.equal(migrated.some((message) => JSON.stringify(message.content).includes('call-old')), false)
  assert.match(String(migrated[2]?.content), /Tool: read/u)
  assert.match(String(migrated[2]?.content), /export const answer = 42/u)
})

test('projectCanonicalReplay applies the migration when Codex follows another provider', () => {
  const document = createEmptyCanonicalHistory('conversation', 1)
  document.events.push({
    anchorUserMessageId: 'user-1',
    branchId: 'main',
    contextFingerprint: 'openai-context',
    createdAt: 2,
    eventId: 'run-openai',
    fidelity: 'exact',
    initialMessages: [],
    modelId: 'gpt-5',
    providerId: 'openai',
    revision: 1,
    runId: 'run-openai',
    type: 'run_started',
  })

  const fallbackMessages = [
    { content: 'Inspect the workspace', role: 'user' },
    {
      content: [{ input: { path: 'src/main.ts' }, toolCallId: 'call-old', toolName: 'read', type: 'tool-call' }],
      role: 'assistant',
    },
    {
      content: [{ output: { type: 'text', value: 'old result' }, toolCallId: 'call-old', toolName: 'read', type: 'tool-result' }],
      role: 'tool',
    },
  ] as ModelMessage[]

  const result = projectCanonicalReplay({
    document,
    fallbackMessages,
    messages: [{ content: 'Continue', id: 'user-2', providerId: 'codex', role: 'user', timestamp: 3 }],
    modelId: 'gpt-5.6-luna',
    providerId: 'codex',
  })

  assert.equal(result.fidelity, 'migrated_legacy')
  assert.equal(result.messages.some((message) => message.role === 'tool'), false)
  assert.match(JSON.stringify(result.messages), /old result/u)
})
