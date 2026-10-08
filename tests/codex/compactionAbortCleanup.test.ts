import '../configureAppRoot'
import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import { compactModelMessages } from '../../electron/chat/shared/compaction/service'
import { reconcileDurableMemory } from '../../electron/chat/shared/compaction/durableMemory'
import type { CompactionStreamFactory } from '../../electron/chat/shared/compaction/contracts'

test('compaction and durable memory remove their parent abort listeners after successful work', async () => {
  const parent = new AbortController()
  let calls = 0
  const createStream: CompactionStreamFactory = async () => {
    calls += 1
    return { fullStream: (async function* () {
      yield { type: 'text-delta' as const, text: '## Current state\n- The workspace change is ready for verification.' }
    })() }
  }
  const messages: ModelMessage[] = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `Turn ${index}. ${'Context evidence. '.repeat(1_000)}`,
  }))
  for (let index = 0; index < 3; index += 1) {
    const result = await compactModelMessages({
      createStream, force: true, messages, model: 'test-model', reasoningEffort: 'low',
      signal: parent.signal, systemPromptTokens: 100, toolSchemaTokens: 100,
    })
    assert.ok(result)
    assert.equal(getEventListeners(parent.signal, 'abort').length, 0)
  }
  assert.equal(calls, 6)
})

test('durable memory releases its abort listener when a provider fails', async () => {
  const parent = new AbortController()
  await assert.rejects(reconcileDurableMemory({
    createStream: async () => { throw new Error('provider failed') },
    messages: [], model: 'test-model', reasoningEffort: 'low', signal: parent.signal,
    sourceDigest: 'test-digest', sourceStartIndex: 0,
  }), /provider failed/)
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0)
})
