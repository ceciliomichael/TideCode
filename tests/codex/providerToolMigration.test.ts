import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import { createEmptyCanonicalHistory } from '../../electron/chat/history/contracts'
import { projectCanonicalReplay } from '../../electron/chat/history/replayProjector'
import { encodeModelMessages, encodeReplayValue } from '../../electron/chat/history/replayCodec'
import { shouldMigrateCrossProviderHistoryToText } from '../../electron/chat/history/providerSwitch'
import { migrateToolHistoryToUserInput } from '../../electron/chat/history/providerToolMigration'
import { buildFallbackCompactionPacket } from '../../electron/chat/shared/compaction/fallback'

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
  assert.equal(shouldMigrateCrossProviderHistoryToText({
    document,
    messages: [],
    targetProviderId: 'mistral',
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

test('projectCanonicalReplay keeps the compacted window when switching from Codex to Mistral', () => {
  const document = createEmptyCanonicalHistory('conversation', 1)
  const packet = buildFallbackCompactionPacket({
    messages: [{ content: 'Old history that was compacted away.', role: 'user' }],
    modelId: 'gpt-5.6-luna',
    providerId: 'codex',
    sourceDigest: 'digest',
    sourceMessageIds: ['model:0'],
  })
  const compactedMessages: ModelMessage[] = [
    { content: 'The retained turn.', role: 'user' },
    {
      content: [{ input: { path: 'src/app.ts' }, toolCallId: 'retained-call', toolName: 'read', type: 'tool-call' }],
      role: 'assistant',
    },
    {
      content: [{ output: { type: 'text', value: 'retained result' }, toolCallId: 'retained-call', toolName: 'read', type: 'tool-result' }],
      role: 'tool',
    },
    { content: packet.continuationMarkdown, role: 'assistant' },
  ]
  document.events.push({
    anchorUserMessageId: 'user-1',
    branchId: 'main',
    compactionId: 'compaction-1',
    createdAt: 2,
    eventId: 'event-1',
    modelId: 'gpt-5.6-luna',
    packet: encodeReplayValue(packet),
    projectedMessages: encodeModelMessages(compactedMessages),
    providerId: 'codex',
    revision: 1,
    runId: null,
    sourceDigest: 'digest',
    sourceMessageIds: ['model:0'],
    type: 'compaction_committed',
    usedFallback: true,
  })

  const result = projectCanonicalReplay({
    document,
    fallbackMessages: [
      { content: 'Old history that was compacted away.', role: 'user' },
      { content: 'A very large old tool result '.repeat(10_000), role: 'tool' },
    ],
    messages: [
      { content: 'Old history that was compacted away.', id: 'user-1', role: 'user', timestamp: 1 },
      { content: 'Old assistant response', id: 'assistant-old', role: 'assistant', timestamp: 2 },
      { content: 'A very large old tool result '.repeat(10_000), id: 'tool-old', role: 'tool', timestamp: 3, toolCallId: 'old-call' },
      { content: 'The next request after compaction.', id: 'user-2', role: 'user', timestamp: 4 },
    ],
    modelId: 'mistral-small-latest',
    providerId: 'mistral',
  })

  assert.equal(result.isCompacted, true)
  assert.equal(result.fidelity, 'exact')
  assert.ok(result.messages.some((message) => message.role === 'tool'))
  assert.match(JSON.stringify(result.messages), /retained result/u)
  assert.ok(result.messages.some((message) => String(message.content).includes('The next request after compaction.')))
  assert.doesNotMatch(JSON.stringify(result.messages), /A very large old tool result/u)
})
