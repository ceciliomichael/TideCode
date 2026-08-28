import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type { ModelMessage } from 'ai'
import {
  buildContinuationMessage,
  repairCompactionPacketContinuation,
  validateContinuationMarkdown,
} from '../../electron/chat/shared/compaction/markdown'
import { createCompactionPacketFixture } from './compactionFixtures'
import { buildCompactionProjection } from '../../electron/chat/shared/compaction/projection'
import {
  extractActionLinkedReasoning,
  mergeCompactionPacketState,
  resolveProviderReasoningCapability,
  resolveReasoningRetention,
} from '../../electron/chat/shared/compaction/reasoning'
import { derivePromptCacheKey } from '../../electron/chat/cache/providerPolicies'
import { buildCompactionRequestPrompt } from '../../electron/chat/shared/compaction/prompt'
import { compactModelMessages } from '../../electron/chat/shared/compaction/service'
import {
  extractUserPromptLedgerEntries,
  mergeUserPromptLedger,
} from '../../electron/chat/shared/compaction/userPromptLedger'
import {
  calculateModelMessagesBudget,
  shouldCompactContext,
} from '../../electron/chat/shared/compaction/budget'
import { configureTideCodeRuntimeRoot } from '../../electron/runtime/runtimeRoot'

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('active compaction keeps the latest user prompt open across completed tool substeps', () => {
  const messages: ModelMessage[] = [
    { role: 'user', content: 'Fix the compaction bug and verify it.' },
    {
      role: 'assistant',
      content: [{
        type: 'tool-call',
        toolCallId: 'call-edit',
        toolName: 'edit',
        input: { path: 'runtime.ts' },
      }],
    },
    {
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call-edit',
        toolName: 'edit',
        output: { type: 'text', value: 'Edit applied successfully.' },
      }],
    },
  ]

  const entries = extractUserPromptLedgerEntries(messages, 0, {
    latestUserSourceMessageId: 'model:0',
    turnState: 'active',
  })

  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.status, 'open')
})

test('settled prompt status distinguishes completed work from an explicitly incomplete ending', () => {
  const completed = extractUserPromptLedgerEntries([
    { role: 'user', content: 'Implement and verify the fix.' },
    { role: 'assistant', content: 'Implemented the fix and all focused tests passed.' },
  ], 0, {
    latestUserSourceMessageId: 'model:0',
    turnState: 'settled',
  })
  const incomplete = extractUserPromptLedgerEntries([
    { role: 'user', content: 'Implement and verify the fix.' },
    { role: 'assistant', content: 'I could not complete verification because the required service is unavailable.' },
  ], 0, {
    latestUserSourceMessageId: 'model:0',
    turnState: 'settled',
  })

  assert.equal(completed[0]?.status, 'completed')
  assert.equal(incomplete[0]?.status, 'open')
})

test('an authoritative active prompt corrects a stale completed ledger entry', () => {
  const merged = mergeUserPromptLedger([
    {
      prompt: 'Fix the compaction bug and verify it.',
      sourceMessageIds: ['model:0'],
      status: 'completed',
      truncated: false,
    },
  ], [
    {
      prompt: 'Fix the compaction bug and verify it.',
      sourceMessageIds: ['model:4'],
      status: 'open',
      truncated: false,
    },
  ], {
    authoritativeOpenSourceMessageId: 'model:4',
  })

  assert.equal(merged.length, 1)
  assert.equal(merged[0]?.status, 'open')
  assert.deepEqual(merged[0]?.sourceMessageIds, ['model:0', 'model:4'])
})

test('compaction prompt exposes the authoritative active-turn lifecycle', () => {
  const prompt = buildCompactionRequestPrompt({
    latestUserSourceMessageId: 'model:7',
    messages: [{ role: 'user', content: 'Continue the active fix.' }],
    sourceDigest: 'active-turn-digest',
    sourceMessageIds: ['model:7'],
    sourceStartIndex: 7,
    turnState: 'active',
  })

  assert.match(prompt, /Current turn: ACTIVE/u)
  assert.match(prompt, /Latest user source message: model:7/u)
  assert.match(prompt, /completed substeps only/u)
  assert.match(prompt, /Keep the latest request open/u)
})

test('v2 continuation accepts natural Markdown and rejects packet JSON or meta-only output', () => {
  const markdown = 'The provider prefix remains stable. Run the focused cache test next.'
  assert.equal(validateContinuationMarkdown(markdown).valid, true)
  assert.equal(validateContinuationMarkdown('{"schema":"tidecode.compaction_packet/v2"}').valid, false)
  assert.equal(validateContinuationMarkdown('Acknowledged.').valid, false)
  assert.equal(
    validateContinuationMarkdown(
      '{"schema":"tidecode.compaction_packet/v2","continuationMarkdown":"'.padEnd(4_000, 'x'),
    ).valid,
    false,
  )

  const message = buildContinuationMessage(markdown)
  assert.equal(message.role, 'assistant')
  assert.equal(message.content, markdown)
  assert.doesNotMatch(String(message.content), /compaction_packet/u)
})

test('a persisted packet with malformed continuation text can rebuild safe Markdown from structured state', () => {
  const packet = createCompactionPacketFixture({
    goal: ['Preserve the verified release state.'],
    sourceDigest: 'repair-digest',
    sourceMessageIds: ['model:0'],
  })
  const repaired = repairCompactionPacketContinuation({
    ...packet,
    continuationMarkdown: '{"schema":"tidecode.compaction_packet/v2","continuationMarkdown":"truncated',
  })

  assert.match(repaired.continuationMarkdown, /## What happened/u)
  assert.doesNotMatch(repaired.continuationMarkdown, /tidecode\.compaction_packet/u)
})

test('compaction transcripts replace image payloads with bounded metadata', () => {
  const dataUrl = `data:image/png;base64,${'A'.repeat(1_000_000)}`
  const prompt = buildCompactionRequestPrompt({
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Inspect this screenshot.' },
        { type: 'image', image: dataUrl, mediaType: 'image/png' },
      ],
    }],
    sourceDigest: 'image-digest',
    sourceMessageIds: ['model:0'],
  })

  assert.match(prompt, /Binary image payload omitted/u)
  assert.match(prompt, /image\/png/u)
  assert.doesNotMatch(prompt, /data:image/u)
  assert.ok(prompt.length < 5_000)
})

test('compaction transcripts also redact nested image files returned by tools', () => {
  const prompt = buildCompactionRequestPrompt({
    messages: [{
      role: 'tool',
      content: [{
        output: {
          type: 'content',
          value: [{
            type: 'file',
            data: { type: 'data', data: new Uint8Array(1_000_000) },
            mediaType: 'image/png',
          }],
        },
        toolCallId: 'read-image',
        toolName: 'read',
        type: 'tool-result',
      }],
    }],
    sourceDigest: 'tool-image-digest',
    sourceMessageIds: ['model:0'],
  })

  assert.match(prompt, /Binary image payload omitted/u)
  assert.ok(prompt.length < 5_000)
})

test('compaction model input excludes persisted runtime context from transcript and prior handoff data', () => {
  const hiddenPlanContext = [
    '<hidden_user_context kind="chat_mode" state="plan">',
    '<chat_mode_context mode="plan" state="active_until_superseded">',
    'Plan Mode is active.',
    '</chat_mode_context>',
    '</hidden_user_context>',
  ].join('\\n')
  const prompt = buildCompactionRequestPrompt({
    messages: [{ role: 'user', content: `Keep this visible request.\\n\\n${hiddenPlanContext}` }],
    previousPacket: {
      continuationMarkdown: `Prior visible handoff.\\n\\n${hiddenPlanContext}`,
      userPromptLedger: [{
        prompt: `Earlier visible request.\\n\\n${hiddenPlanContext}`,
        sourceMessageIds: ['model:0'],
        status: 'completed',
        truncated: false,
      }],
    },
    sourceDigest: 'hidden-context-digest',
    sourceMessageIds: ['model:1'],
  })

  assert.match(prompt, /Keep this visible request\./u)
  assert.match(prompt, /Prior visible handoff\./u)
  assert.match(prompt, /Earlier visible request\./u)
  assert.doesNotMatch(prompt, /hidden_user_context|chat_mode_context|Plan Mode is active/u)
})

test('visible action rationale is source-linked without copying provider-private reasoning', () => {
  const messages: ModelMessage[] = [
    { role: 'user', content: 'Inspect the entry point before editing it.' },
    {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'private provider reasoning' },
        { type: 'text', text: 'I will inspect the entry point because the current behavior is unverified.' },
        { type: 'tool-call', toolCallId: 'call-1', toolName: 'read_file', input: { path: 'src/main.ts' } },
      ],
    },
    {
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'read_file',
        output: { type: 'text', value: 'export function main() {}' },
      }],
    },
  ]

  const entries = extractActionLinkedReasoning(messages)
  assert.equal(entries.length, 1)
  assert.match(entries[0]?.rationale ?? '', /inspect the entry point/u)
  assert.doesNotMatch(entries[0]?.rationale ?? '', /private provider reasoning/u)
  assert.deepEqual(entries[0]?.sourceMessageIds, ['model:1', 'model:2'])

  const retention = resolveReasoningRetention({
    capability: resolveProviderReasoningCapability({ modelId: 'deepseek-v4-pro', providerId: 'deepseek' }),
    messages,
  })
  assert.equal(retention.mode, 'replayed_provider_native')
})

test('packet merging keeps parent lineage and bounds continuity while preserving the stable cache key', () => {
  const previous = createCompactionPacketFixture({
    continuationMarkdown: ['## Current state', '- Keep the provider cache prefix stable.'].join('\n'),
    sourceDigest: 'digest-1',
    sourceMessageIds: ['model:0'],
  })
  const current = createCompactionPacketFixture({
    continuationMarkdown: ['## Current state', '- Validate DeepSeek reasoning replay.'].join('\n'),
    sourceDigest: 'digest-2',
    sourceMessageIds: ['model:1'],
  })
  const merged = mergeCompactionPacketState({
    current,
    parentPacketId: previous.packetId,
    previous,
  })

  assert.equal(merged.parentPacketId, previous.packetId)
  assert.equal(merged.schema, 'tidecode.compaction_packet/v2')
  assert.ok(merged.continuationMarkdown.length > 0)
  assert.ok(merged.reasoningContinuity.length <= 32)
  assert.equal(
    derivePromptCacheKey({
      cacheScopeId: 'lineage-root',
      contextFingerprint: 'stable-context',
      modelId: 'deepseek-v4-pro',
      providerId: 'deepseek',
    }),
    derivePromptCacheKey({
      cacheScopeId: 'lineage-root',
      contextFingerprint: 'stable-context',
      modelId: 'deepseek-v4-pro',
      providerId: 'deepseek',
    }),
  )
})

test('compaction status reconciliation removes completed work from open items and next actions', () => {
  const previous = createCompactionPacketFixture({
    sourceDigest: 'digest-previous-status',
    sourceMessageIds: ['model:0'],
  })
  const current = createCompactionPacketFixture({
    sourceDigest: 'digest-current-status',
    sourceMessageIds: ['model:1'],
  })

  const merged = mergeCompactionPacketState({
    current: {
      ...current,
      completedWork: ['Implemented the compaction state ledger.'],
      currentState: ['The new status ledger is the current state.'],
      openItems: [
        'The compaction state ledger is complete.',
        'Verify the compaction state ledger.',
        'Verify the remaining documentation.',
      ],
      nextActions: [
        'The compaction state ledger is complete.',
        'Verify the compaction state ledger.',
        'Verify the remaining documentation.',
      ],
      planState: ['The documentation check remains open.'],
    },
    parentPacketId: previous.packetId,
    previous: {
      ...previous,
      currentState: ['The old append-only state is stale.'],
      openItems: ['Implement the compaction state ledger.'],
      nextActions: ['Implement the compaction state ledger.'],
      planState: ['Implement the compaction state ledger.'],
    },
  })

  assert.deepEqual(merged.openItems, ['Verify the compaction state ledger.', 'Verify the remaining documentation.'])
  assert.deepEqual(merged.nextActions, ['Verify the compaction state ledger.', 'Verify the remaining documentation.'])
  assert.deepEqual(merged.currentState, ['The new status ledger is the current state.'])
  assert.deepEqual(merged.planState, ['The documentation check remains open.'])
  assert.ok(merged.completedWork.some((item) => /compaction state ledger/iu.test(item)))
})

test('the projected continuation preserves the AI-generated Markdown across compaction lineage merges', () => {
  const previous = createCompactionPacketFixture({
    sourceDigest: 'digest-previous',
    sourceMessageIds: ['model:0'],
  })
  const generatedMarkdown = 'The release metadata change is complete. The next step is to run the whitespace check.'
  const current = createCompactionPacketFixture({
    sourceDigest: 'digest-current',
    sourceMessageIds: ['model:1'],
  })
  const merged = mergeCompactionPacketState({
    current: { ...current, continuationMarkdown: generatedMarkdown },
    parentPacketId: previous.packetId,
    previous,
  })

  assert.equal(merged.continuationMarkdown, generatedMarkdown)
})

test('automatic compaction reduces a single oversized tool-heavy turn below the provider window', async () => {
  const messages: ModelMessage[] = [
    { role: 'user', content: 'Inspect the release files and keep working until verification is complete.' },
    {
      role: 'assistant',
      content: [{
        type: 'tool-call',
        toolCallId: 'call-package',
        toolName: 'read',
        input: { path: 'package-lock.json' },
      }],
    },
    {
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call-package',
        toolName: 'read',
        output: { type: 'text', value: `package-lock evidence ${'P'.repeat(700_000)}` },
      }],
    },
    {
      role: 'assistant',
      content: [{
        type: 'tool-call',
        toolCallId: 'call-changelog',
        toolName: 'read',
        input: { path: 'CHANGELOG.md' },
      }],
    },
    {
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call-changelog',
        toolName: 'read',
        output: { type: 'text', value: `changelog evidence ${'C'.repeat(500_000)}` },
      }],
    },
    { role: 'assistant', content: 'The release still needs the final verification command.' },
  ]
  const budgetInput = {
    contextWindowTokens: 200_000,
    messages,
    systemPromptTokens: 5_000,
    toolSchemaTokens: 0,
    triggerRatio: 0.8,
  }
  const before = calculateModelMessagesBudget(budgetInput)
  const previousRuntimeRoot = process.env.TIDECODE_RUNTIME_ROOT
  let started = 0

  assert.equal(shouldCompactContext(before), true)

  try {
    configureTideCodeRuntimeRoot(workspaceRoot)
    const compacted = await compactModelMessages({
      ...budgetInput,
      createStream: async () => ({
        fullStream: (async function* () {
          yield {
            type: 'text-delta',
            text: 'The release files were inspected. Large intermediate file contents were reduced to verified handoff facts. The final verification command is still pending.',
          }
        })(),
      }),
      model: 'test-model',
      onStarted: () => {
        started += 1
      },
      providerId: 'codex',
      reasoningEffort: 'medium',
      retainedContextTokens: 10_000,
    })

    assert.ok(compacted)
    assert.equal(started, 1)
    assert.equal(compacted.boundaryIndex, messages.length)
    assert.equal(compacted.packet.sourceRange?.startIndex, 0)
    assert.equal(compacted.packet.sourceRange?.endIndex, messages.length)
    assert.equal(compacted.projectedMessages.some((message) => message.role === 'tool'), false)

    const after = calculateModelMessagesBudget({
      ...budgetInput,
      messages: compacted.projectedMessages,
    })
    assert.ok(after.totalTokens < before.totalTokens)
    assert.ok(after.totalTokens < after.contextWindowTokens)
    assert.equal(shouldCompactContext(after), false)
  } finally {
    if (previousRuntimeRoot === undefined) delete process.env.TIDECODE_RUNTIME_ROOT
    else process.env.TIDECODE_RUNTIME_ROOT = previousRuntimeRoot
  }
})

test('projection emits one Markdown continuation and removes raw tool history from the semantic tail', () => {
  const packet = createCompactionPacketFixture({
    sourceDigest: 'digest',
    sourceMessageIds: ['model:0'],
  })
  const toolCall: ModelMessage = {
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'read', input: { path: 'src/main.ts' } }],
  }
  const toolResult: ModelMessage = {
    role: 'tool',
    content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'read', output: { type: 'text', value: 'ok' } }],
  }
  const projected = buildCompactionProjection({
    anchorMessages: [{ role: 'user', content: 'Inspect the workspace.' }],
    packet,
    tailMessages: [toolCall, toolResult, { role: 'assistant', content: 'The result is ready.' }],
  })

  assert.equal(projected.filter((message) => message.role === 'assistant' && message.content === packet.continuationMarkdown).length, 1)
  assert.deepEqual(projected.slice(-1), [{ role: 'assistant', content: 'The result is ready.' }])
  assert.equal(projected.some((message) => message.role === 'tool'), false)
  assert.doesNotMatch(JSON.stringify(projected), /tool-call|tool-result/u)
  assert.equal(projected.some((message) => typeof message.content === 'string' && message.content.includes('tidecode.compaction_packet/v2')), false)
})

test('projection carries the latest runtime context only after the compaction handoff', () => {
  const packet = createCompactionPacketFixture({
    sourceDigest: 'runtime-carry-digest',
    sourceMessageIds: ['model:0'],
  })
  const hiddenAgentContext = [
    '<hidden_user_context kind="chat_mode" state="agent">',
    '<chat_mode_context mode="agent" state="active_until_superseded">',
    'Agent Mode is active.',
    '</chat_mode_context>',
    '</hidden_user_context>',
  ].join('\\n')
  const projected = buildCompactionProjection({
    anchorMessages: [],
    contextMessages: [{ role: 'user', content: `Visible request.\\n\\n${hiddenAgentContext}` }],
    packet,
    tailMessages: [{ role: 'assistant', content: 'Recent visible result.' }],
  })

  assert.doesNotMatch(String(projected[0]?.content ?? ''), /hidden_user_context|chat_mode_context/u)
  assert.equal(projected[1]?.role, 'user')
  assert.equal(projected[1]?.content, hiddenAgentContext)
  assert.deepEqual(projected.slice(-1), [{ role: 'assistant', content: 'Recent visible result.' }])
})

test('projection converts image placeholders into provider-valid text parts', () => {
  const packet = createCompactionPacketFixture({
    sourceDigest: 'image-projection-digest',
    sourceMessageIds: ['model:0'],
  })
  const projected = buildCompactionProjection({
    anchorMessages: [],
    packet,
    tailMessages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'The screenshot is attached.' },
        { type: 'image-reference', mediaType: 'image/png', note: 'Binary image payload omitted from the text-only compaction transcript.' },
      ],
    }],
  })

  const tail = projected.at(-1)
  assert.equal(tail?.role, 'user')
  assert.deepEqual(tail?.content, [
    { type: 'text', text: 'The screenshot is attached.' },
    { type: 'text', text: 'Binary image payload omitted from the text-only compaction transcript.' },
  ])
  assert.doesNotMatch(JSON.stringify(projected), /image-reference/u)
})

test('token projection retains real image content in the recent context tail', () => {
  const packet = createCompactionPacketFixture({
    sourceDigest: 'retained-image-digest',
    sourceMessageIds: ['model:0'],
  })
  const imagePart = {
    data: { data: 'encoded-image', type: 'data' },
    mediaType: 'image/png',
    type: 'file',
  } as const
  const tailMessages: ModelMessage[] = []
  for (let turn = 1; turn <= 5; turn += 1) {
    tailMessages.push({
      role: 'user',
      content: turn === 3 ? [{ text: `Turn ${turn}`, type: 'text' }, imagePart] : `Turn ${turn}`,
    })
    tailMessages.push({ role: 'assistant', content: `Response ${turn}` })
  }

  const projected = buildCompactionProjection({
    anchorMessages: [],
    packet,
    tailMessages,
  })

  const retainedUsers = projected.filter((message) => message.role === 'user')
  assert.deepEqual(retainedUsers.map((message) => message.content), [
    'Turn 1',
    'Turn 2',
    [{ text: 'Turn 3', type: 'text' }, imagePart],
    'Turn 4',
    'Turn 5',
  ])
})
