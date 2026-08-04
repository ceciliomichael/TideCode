import assert from 'node:assert/strict'
import test from 'node:test'
import { jsonSchema, type ModelMessage, type ToolSet } from 'ai'
import { buildPromptContextFingerprint, stableStringify } from '../../electron/chat/cache/canonicalization'
import {
  applyPromptCacheBreakpoints,
  derivePromptCacheKey,
  mergeProviderOptions,
  resolvePromptCacheExtraBody,
  resolvePromptCacheProviderOptions,
} from '../../electron/chat/cache/providerPolicies'
import { normalizeLanguageModelUsage } from '../../electron/chat/cache/usage'
import { createEmptyCanonicalHistory, getReplaySlotKey } from '../../electron/chat/history/contracts'
import { decodeModelMessages, encodeModelMessages } from '../../electron/chat/history/replayCodec'
import { projectCanonicalReplay } from '../../electron/chat/history/replayProjector'
import { createCanonicalToolModelOutput, withCanonicalToolModelOutputs } from '../../electron/chat/shared/toolReplay'
import { formatStructuredToolResultContent } from '../../src/lib/toolResultContent'
import type { Message } from '../../src/types/chat'

test('stable prompt manifests and cache keys ignore object insertion order', () => {
  assert.equal(stableStringify({ b: 2, a: { d: 4, c: 3 } }), stableStringify({ a: { c: 3, d: 4 }, b: 2 }))

  const toolsA = {
    read: {
      description: 'Read a file',
      execute: async () => 'ok',
      inputSchema: jsonSchema({ properties: { path: { type: 'string' } }, required: ['path'], type: 'object' }),
    },
  } as ToolSet
  const toolsB = { read: toolsA.read } as ToolSet
  const fingerprintA = buildPromptContextFingerprint({ modelId: 'model', providerId: 'openai', system: 'system', tools: toolsA })
  const fingerprintB = buildPromptContextFingerprint({ modelId: 'model', providerId: 'openai', system: 'system', tools: toolsB })
  assert.equal(fingerprintA, fingerprintB)
  assert.equal(
    derivePromptCacheKey({ cacheScopeId: 'conversation', contextFingerprint: fingerprintA, modelId: 'model', providerId: 'openai' }),
    derivePromptCacheKey({ cacheScopeId: 'conversation', contextFingerprint: fingerprintB, modelId: 'model', providerId: 'openai' }),
  )
})

test('prompt cache keys stay stable across a compaction lineage and partition unrelated chats', () => {
  const input = {
    cacheScopeId: 'lineage-root',
    contextFingerprint: 'shared-context',
    modelId: 'model',
    providerId: 'openai' as const,
  }

  assert.equal(derivePromptCacheKey(input), derivePromptCacheKey({ ...input }))
  assert.notEqual(
    derivePromptCacheKey(input),
    derivePromptCacheKey({ ...input, cacheScopeId: 'unrelated-chat' }),
  )
})

test('provider cache policies are capability-gated and cannot replace reasoning settings', () => {
  assert.deepEqual(resolvePromptCacheProviderOptions({ cacheKey: 'key', providerId: 'openai' }), {
    openai: { promptCacheKey: 'key' },
  })
  assert.deepEqual(resolvePromptCacheProviderOptions({ cacheKey: 'key', providerId: 'anthropic' }), {
    anthropic: { cacheControl: { ttl: '5m', type: 'ephemeral' } },
  })
  assert.deepEqual(resolvePromptCacheProviderOptions({ cacheKey: 'key', providerId: 'google' }), undefined)
  assert.deepEqual(resolvePromptCacheExtraBody({ cacheKey: 'key', providerId: 'mistral' }), { prompt_cache_key: 'key' })
  assert.deepEqual(
    mergeProviderOptions(
      { openai: { reasoningEffort: 'high' } },
      { openai: { promptCacheKey: 'key' } },
    ),
    { openai: { promptCacheKey: 'key', reasoningEffort: 'high' } },
  )
})

test('Anthropic receives one deterministic tool cache breakpoint while other providers stay unchanged', () => {
  const tools = {
    read: {
      description: 'Read a file',
      inputSchema: jsonSchema({ properties: {}, type: 'object' }),
    },
    write: {
      description: 'Write a file',
      inputSchema: jsonSchema({ properties: {}, type: 'object' }),
    },
  } as ToolSet

  const anthropicTools = applyPromptCacheBreakpoints(tools, 'anthropic')
  assert.deepEqual(anthropicTools.write.providerOptions, {
    anthropic: { cacheControl: { ttl: '5m', type: 'ephemeral' } },
  })
  assert.equal(anthropicTools.read.providerOptions, undefined)
  assert.equal(applyPromptCacheBreakpoints(tools, 'google'), tools)
  assert.equal(applyPromptCacheBreakpoints(tools, 'mistral'), tools)
  assert.equal(applyPromptCacheBreakpoints(tools, 'deepseek'), tools)
  assert.equal(applyPromptCacheBreakpoints(tools, 'custom:local'), tools)
  assert.deepEqual(resolvePromptCacheProviderOptions({ cacheKey: 'key', providerId: 'custom:local' }), undefined)
  assert.deepEqual(resolvePromptCacheExtraBody({ cacheKey: 'key', providerId: 'custom:local' }), {})
})

test('replay codec retains reasoning metadata and binary provider state', () => {
  const messages = [{
    content: [{
      providerOptions: { openai: { encryptedContent: new Uint8Array([1, 2, 3]), itemId: 'reasoning-item' } },
      text: 'A provider-visible reasoning summary',
      type: 'reasoning',
    }, { text: 'Answer', type: 'text' }],
    role: 'assistant',
  }] as ModelMessage[]
  const decoded = decodeModelMessages(encodeModelMessages(messages))
  assert.deepEqual(decoded, messages)
})

test('exact replay replaces display-normalized assistant history and appends only the new user turn', () => {
  const document = createEmptyCanonicalHistory('conversation', 1)
  const exactMessages = [{ content: 'first question', role: 'user' }, {
    content: [{ providerOptions: { openai: { itemId: 'opaque' } }, text: 'reasoning', type: 'reasoning' }, { text: 'exact answer', type: 'text' }],
    role: 'assistant',
  }] as ModelMessage[]
  document.replay = {
    anchorUserMessageId: 'user-1',
    branchId: 'main',
    contextFingerprint: 'context',
    fidelity: 'exact',
    freshnessRevision: 0,
    messages: encodeModelMessages(exactMessages),
    modelId: 'model',
    providerId: 'openai',
    runId: 'run-1',
    sourceRevision: 1,
    updatedAt: 2,
  }
  const displayMessages: Message[] = [
    { content: 'first question', id: 'user-1', role: 'user', timestamp: 1 },
    { content: 'normalized answer', id: 'assistant-1', role: 'assistant', timestamp: 2 },
    { content: 'second question', id: 'user-2', role: 'user', timestamp: 3 },
  ]
  const result = projectCanonicalReplay({
    document,
    fallbackMessages: [{ content: 'legacy', role: 'user' }],
    messages: displayMessages,
    modelId: 'model',
    providerId: 'openai',
  })
  assert.equal(result.fidelity, 'exact')
  assert.equal(result.isCompacted, false)
  assert.deepEqual(result.messages, [...exactMessages, { content: 'second question', role: 'user' }])
})

test('compacted replay retains assistant and tool responses from later turns', () => {
  const document = createEmptyCanonicalHistory('conversation', 1)
  const compactedMessages = [
    { content: 'first question', role: 'user' },
    { content: 'tidecode.compaction_state.v1\nRetained state', role: 'assistant' },
  ] as ModelMessage[]
  document.events.push({
    anchorUserMessageId: 'user-1',
    branchId: 'main',
    compactionId: 'compaction-1',
    createdAt: 2,
    eventId: 'event-1',
    modelId: 'model',
    packet: encodeModelMessages([]),
    projectedMessages: encodeModelMessages(compactedMessages),
    providerId: 'openai',
    revision: 1,
    runId: null,
    sourceDigest: 'digest',
    sourceMessageIds: ['model:0'],
    type: 'compaction_committed',
    usedFallback: true,
  })

  const displayMessages: Message[] = [
    { content: 'first question', id: 'user-1', role: 'user', timestamp: 1 },
    { content: 'old response replaced by compaction', id: 'assistant-1', role: 'assistant', timestamp: 2 },
    { content: 'second question', id: 'user-2', role: 'user', timestamp: 3 },
    {
      content: '',
      id: 'assistant-2',
      role: 'assistant',
      timestamp: 4,
      toolInvocations: [{
        argumentsText: JSON.stringify({ command: 'npm test' }),
        completedAt: 5,
        id: 'tool-call-2',
        resultContent: 'tests passed',
        startedAt: 4,
        state: 'completed',
        toolName: 'execute_terminal',
      }],
    },
    {
      content: formatStructuredToolResultContent({
        arguments: { command: 'npm test' },
        schema: 'tidecode.tool_result/v1',
        status: 'success',
        summary: 'Ran tests',
        toolCallId: 'tool-call-2',
        toolName: 'execute_terminal',
      }, 'tests passed'),
      id: 'tool-2',
      role: 'tool',
      timestamp: 5,
      toolCallId: 'tool-call-2',
    },
  ]

  const result = projectCanonicalReplay({
    document,
    fallbackMessages: [{ content: 'legacy', role: 'user' }],
    messages: displayMessages,
    modelId: 'model',
    providerId: 'openai',
  })

  assert.equal(result.isCompacted, true)
  assert.deepEqual(result.messages.map((message) => message.role), ['user', 'assistant', 'user', 'assistant', 'tool'])
})

test('provider and model replay slots survive switching away and back', () => {
  const document = createEmptyCanonicalHistory('conversation', 1)
  const deepSeekMessages = [{ content: 'deepseek question', role: 'user' }, { content: 'deepseek answer', role: 'assistant' }] as ModelMessage[]
  document.replays[getReplaySlotKey('deepseek', 'deepseek-v4-pro')] = {
    anchorUserMessageId: 'user-1',
    branchId: 'main',
    contextFingerprint: 'deepseek-context',
    fidelity: 'exact',
    freshnessRevision: 0,
    messages: encodeModelMessages(deepSeekMessages),
    modelId: 'deepseek-v4-pro',
    providerId: 'deepseek',
    runId: 'deepseek-run',
    sourceRevision: 1,
    updatedAt: 2,
  }
  document.replay = {
    ...document.replays[getReplaySlotKey('deepseek', 'deepseek-v4-pro')],
    contextFingerprint: 'openai-context',
    messages: encodeModelMessages([{ content: 'openai question', role: 'user' }]),
    modelId: 'gpt-5',
    providerId: 'openai',
    runId: 'openai-run',
  }
  const result = projectCanonicalReplay({
    document,
    fallbackMessages: [{ content: 'legacy', role: 'user' }],
    messages: [{ content: 'deepseek question', id: 'user-1', role: 'user', timestamp: 1 }],
    modelId: 'deepseek-v4-pro',
    providerId: 'deepseek',
  })
  assert.equal(result.replayRunId, 'deepseek-run')
  assert.deepEqual(result.messages, deepSeekMessages)
})

test('canonical tool model output is byte-identical for live and wrapped tool execution', async () => {
  const rawResult = { body: 'file contents', status: 'success' as const, subject: { path: 'src/app.ts' }, summary: 'Read file' }
  const expected = createCanonicalToolModelOutput({
    argumentsValue: { path: 'src/app.ts' },
    output: rawResult,
    toolCallId: 'call-1',
    toolName: 'read',
  })
  const tools = withCanonicalToolModelOutputs({
    read: {
      execute: async () => rawResult,
      inputSchema: jsonSchema({ properties: { path: { type: 'string' } }, type: 'object' }),
    },
  } as ToolSet)
  const wrapped = await tools.read.toModelOutput?.({
    input: { path: 'src/app.ts' },
    output: rawResult,
    toolCallId: 'call-1',
  })
  assert.deepEqual(wrapped, expected)
  assert.equal(expected.type, 'text')
})

test('usage normalization records cache reads, writes, uncached input, and reasoning', () => {
  assert.deepEqual(normalizeLanguageModelUsage({
    inputTokenDetails: { cacheReadTokens: 800, cacheWriteTokens: 100, noCacheTokens: 200 },
    inputTokens: 1_000,
    outputTokenDetails: { reasoningTokens: 50, textTokens: 25 },
    outputTokens: 75,
    totalTokens: 1_075,
  }), {
    cacheReadTokens: 800,
    cacheWriteTokens: 100,
    inputTokens: 1_000,
    noCacheTokens: 200,
    outputTokens: 75,
    reasoningTokens: 50,
    totalTokens: 1_075,
  })
})

test('usage normalization recovers DeepSeek-compatible raw cache fields', () => {
  const usage = normalizeLanguageModelUsage({
    inputTokenDetails: { cacheReadTokens: undefined, cacheWriteTokens: undefined, noCacheTokens: undefined },
    inputTokens: 1_000,
    outputTokenDetails: { reasoningTokens: undefined, textTokens: undefined },
    outputTokens: 25,
    raw: { prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100 },
    totalTokens: 1_025,
  })
  assert.equal(usage.cacheReadTokens, 900)
  assert.equal(usage.noCacheTokens, 100)
})

test('DeepSeek raw miss tokens override the generic compatible-adapter fallback', () => {
  const usage = normalizeLanguageModelUsage({
    inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: undefined, noCacheTokens: 1_000 },
    inputTokens: 1_000,
    outputTokenDetails: { reasoningTokens: undefined, textTokens: undefined },
    outputTokens: 25,
    raw: { prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100 },
    totalTokens: 1_025,
  })
  assert.equal(usage.cacheReadTokens, 900)
  assert.equal(usage.noCacheTokens, 100)
})

test('usage normalization preserves explicit zero uncached tokens and provider cache aliases', () => {
  const fullyCached = normalizeLanguageModelUsage({
    inputTokenDetails: { cacheReadTokens: undefined, cacheWriteTokens: undefined, noCacheTokens: undefined },
    inputTokens: 1_000,
    outputTokenDetails: { reasoningTokens: undefined, textTokens: undefined },
    outputTokens: 25,
    raw: { cachedContentTokenCount: 1_000, prompt_cache_miss_tokens: 0 },
    totalTokens: 1_025,
  })
  assert.equal(fullyCached.cacheReadTokens, 1_000)
  assert.equal(fullyCached.noCacheTokens, 0)

  const mistralUsage = normalizeLanguageModelUsage({
    inputTokenDetails: { cacheReadTokens: undefined, cacheWriteTokens: undefined, noCacheTokens: undefined },
    inputTokens: 1_000,
    outputTokenDetails: { reasoningTokens: undefined, textTokens: undefined },
    outputTokens: 25,
    raw: { num_cached_tokens: 800 },
    totalTokens: 1_025,
  })
  assert.equal(mistralUsage.cacheReadTokens, 800)
  assert.equal(mistralUsage.noCacheTokens, 200)
})
