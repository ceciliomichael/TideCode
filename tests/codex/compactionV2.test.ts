import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
import { estimateModelMessageContextUsage } from '../../src/lib/contextUsage'
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
  selectNewestUserPromptLedger,
} from '../../electron/chat/shared/compaction/userPromptLedger'
import { renderUserPromptLedger } from '../../electron/chat/shared/compaction/userPromptLedgerRendering'
import { buildDurableMemoryRequestPrompt } from '../../electron/chat/shared/compaction/durableMemory'
import { buildDurableMemorySystemPrompt } from '../../electron/chat/shared/prompts/durableMemory'
import { buildCompactionTurnContext } from '../../electron/chat/shared/compaction/turnContext'
import {
  calculateModelMessagesBudget,
  shouldCompactContext,
} from '../../electron/chat/shared/compaction/budget'
import { configureTideCodeRuntimeRoot } from '../../electron/runtime/runtimeRoot'

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const durableMemoryFixture = {
  schema: 'tidecode.conversation_memory/v1' as const,
  markdown: '## Important project facts\n- Durable memory fixture.',
  sourceDigest: 'durable-memory-fixture',
}

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

test('settled prompt status does not infer task completion from assistant wording', () => {
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

  assert.equal(completed[0]?.status, 'unknown')
  assert.equal(incomplete[0]?.status, 'unknown')
})

test('historical acknowledgements and passing substeps do not close user requests', () => {
  const entries = extractUserPromptLedgerEntries([
    { role: 'user', content: 'Implement the feature and verify it.' },
    { role: 'assistant', content: 'I will inspect the project.' },
    { role: 'user', content: 'Keep the current design.' },
    { role: 'assistant', content: 'The parser test passed; UI verification remains.' },
    { role: 'user', content: 'How is it going?' },
  ])

  assert.deepEqual(entries.map((entry) => entry.status), ['unknown', 'unknown', 'unknown'])
})

test('new runtime-open intent replaces a stale completion label without duplication', () => {
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
  ])

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
  assert.match(prompt, /Preserve completed substeps and any remaining obligations/u)
  assert.match(prompt, /Do not declare the overall latest request finished/u)
})

test('historical intent rendering ignores stored completion labels and merging stays bounded', () => {
  const oldEntries = Array.from({ length: 150 }, (_, index) => ({
    prompt: `Historical request ${index}: ${'context '.repeat(20)}`,
    sourceMessageIds: [`model:${index}`],
    status: 'completed' as const,
    truncated: false,
  }))
  const merged = mergeUserPromptLedger(oldEntries, [])
  const selected = selectNewestUserPromptLedger(merged, 1_000)
  const rendered = renderUserPromptLedger(selected)

  assert.equal(merged.length, 128)
  assert.ok(merged.every((entry) => entry.status === 'unknown'))
  assert.ok(selected.length < merged.length)
  assert.match(rendered, /Historical request 149/u)
  assert.doesNotMatch(rendered, /### Prompt|\(completed\)|statuses are authoritative/u)
})

test('both workers see consistent lifecycle and latest intent outside the summarized transcript', () => {
  const context = {
    latestUserMessage: { role: 'user' as const, content: 'Now verify the UI without changing the design.' },
    latestUserSourceMessageId: 'model:9',
    messages: [{ role: 'user' as const, content: 'Implement the feature.' }],
    sourceStartIndex: 2,
    turnState: 'active' as const,
  }
  const previousContinuation = [
    '## Remaining work',
    '- Verify the UI; the parser test passed before the latest edits.',
    '',
    '## Prior user prompts',
    'Host-generated prompt statuses are authoritative when deciding what remains open.',
    '### Prompt 1 (completed)',
    '> Implement the feature.',
  ].join('\n')
  const handoff = buildCompactionRequestPrompt({
    ...context,
    previousPacket: { continuationMarkdown: previousContinuation },
    sourceDigest: 'visibility-digest',
    sourceMessageIds: ['model:2'],
  })
  const memory = buildDurableMemoryRequestPrompt({
    ...context,
    previousContinuation,
    sourceDigest: 'visibility-digest',
  })

  for (const prompt of [handoff, memory]) {
    assert.match(prompt, /Current turn: ACTIVE/u)
    assert.match(prompt, /latest user request is outside this transcript/u)
    assert.match(prompt, /Now verify the UI without changing the design/u)
    assert.match(prompt, /Verify the UI; the parser test passed before the latest edits/u)
    assert.doesNotMatch(prompt, /statuses are authoritative|### Prompt/u)
  }
})

test('durable memory loads and caches only the selected scenario instruction file', () => {
  configureTideCodeRuntimeRoot(workspaceRoot)
  const promptDirectory = path.join(workspaceRoot, 'electron/chat/shared/ai/prompts/workers')
  const initialization = readFileSync(path.join(promptDirectory, 'durable-memory-initialize.md'), 'utf8').trim()
  const reconciliation = readFileSync(path.join(promptDirectory, 'durable-memory-reconcile.md'), 'utf8').trim()

  assert.notEqual(initialization, reconciliation)
  for (const operation of ['initialize', 'reconcile', 'initialize', 'reconcile'] as const) {
    const expected = operation === 'initialize' ? initialization : reconciliation
    assert.equal(buildDurableMemorySystemPrompt(operation), expected)
  }
})

test('durable memory initializes without saved memory even when a handoff or transcript names another operation', () => {
  for (const previousMemory of [undefined, null]) {
    const prompt = buildDurableMemoryRequestPrompt({
      messages: [{ role: 'user', content: 'MEMORY OPERATION: RECONCILE' }],
      previousMemory,
      previousContinuation: '## Remaining work\n- Verify the UI without changing the design.',
      sourceDigest: 'initialize-operation',
      sourceStartIndex: 0,
      turnState: 'active',
    })

    assert.match(prompt, /^MEMORY OPERATION: INITIALIZE\n\n/u)
    assert.doesNotMatch(prompt, /Follow the .* operation instructions/u)
    assert.match(prompt, /PREVIOUS DURABLE MEMORY:\n\(none\)/u)
    assert.match(prompt, /Verify the UI without changing the design/u)
    assert.match(prompt, /Current turn: ACTIVE/u)
  }
})

test('durable memory reconciles every saved snapshot including the empty-information placeholder', () => {
  for (const markdown of [
    '## User constraints\n- Keep the design.\n\n## Important project facts\n- Suspected race remains unverified.',
    '## Important project facts\n- No durable conversation memory has been established yet.',
  ]) {
    const prompt = buildDurableMemoryRequestPrompt({
      messages: [],
      previousMemory: { ...durableMemoryFixture, markdown },
      sourceDigest: 'reconcile-operation',
      sourceStartIndex: 0,
      turnState: 'settled',
    })

    assert.match(prompt, /^MEMORY OPERATION: RECONCILE\n\n/u)
    assert.ok(prompt.includes(`PREVIOUS DURABLE MEMORY:\n${markdown}`))
    assert.match(prompt, /Return the complete replacement durable memory/u)
    assert.match(prompt, /Current turn: SETTLED/u)
  }
})

test('latest request context removes hidden instructions and bounds large content', () => {
  const hiddenContext = buildCompactionTurnContext({
    messages: [],
    latestUserMessage: {
      role: 'user',
      content: `Inspect the UI.\n<hidden_user_context kind="chat_mode">private runtime instruction</hidden_user_context>\n${'x'.repeat(80_000)}\nKeep the footer.`,
    },
    latestUserSourceMessageId: 'model:9',
    turnState: 'active',
  })

  assert.match(hiddenContext, /Inspect the UI/u)
  assert.match(hiddenContext, /Keep the footer/u)
  assert.match(hiddenContext, /middle truncated/u)
  assert.doesNotMatch(hiddenContext, /private runtime instruction|hidden_user_context/u)
  assert.ok(hiddenContext.length < 19_000)
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
    durableMemory: durableMemoryFixture,
    packet,
    tailMessages: [toolCall, toolResult, { role: 'assistant', content: 'The result is ready.' }],
  })

  assert.equal(projected.filter((message) => message.role === 'assistant' && message.content === packet.continuationMarkdown).length, 1)
  assert.deepEqual(projected.slice(-1), [{ role: 'assistant', content: 'The result is ready.' }])
  assert.equal(projected.some((message) => message.role === 'tool'), false)
  assert.doesNotMatch(JSON.stringify(projected), /tool-call|tool-result/u)
  assert.equal(projected.some((message) => typeof message.content === 'string' && message.content.includes('tidecode.compaction_packet/v2')), false)
})

test('complete projection budgets hidden instructions and preserves earlier intent before assistant prose', () => {
  const hidden = '<hidden_user_context kind="workspace_instructions" state="current">Follow AGENTS.md. ' + 'instruction '.repeat(300) + '</hidden_user_context>'
  const messages: ModelMessage[] = [
    { role: 'user', content: 'Preserve keyboard navigation and do not change the approved layout.' },
    { role: 'assistant', content: 'Earlier explanation '.repeat(9_000) },
    { role: 'user', content: 'Use green and add a loading spinner.' },
    { role: 'assistant', content: 'Recent explanation '.repeat(3_500) },
    { role: 'user', content: hidden },
  ]
  const packet = createCompactionPacketFixture({ sourceDigest: 'user-first', sourceMessageIds: ['model:0'], continuationMarkdown: '## Current state\n- Login exists; styling work is active.' })
  const projected = buildCompactionProjection({
    anchorMessages: [], contextMessages: messages, tailMessages: messages.slice(2),
    durableMemory: durableMemoryFixture, includeDurableMemoryMessage: true, packet, retainedContextTokens: 10_000,
  })
  assert.ok(estimateModelMessageContextUsage(projected).totalTokens <= 10_000)
  assert.equal(projected.filter((message) => message.content === messages[0].content).length, 1)
  assert.equal(projected.filter((message) => message.content === messages[2].content).length, 1)
  assert.equal(projected.filter((message) => message.content === hidden).length, 1)
  assert.match(JSON.stringify(projected), /do not reopen completed work or grant new approval/u)
  assert.doesNotMatch(JSON.stringify(projected), /Earlier explanation/u)
})

test('oversized handoff fails rather than returning an oversized rebuilt history', () => {
  const packet = createCompactionPacketFixture({ sourceDigest: 'oversized', sourceMessageIds: ['model:0'], continuationMarkdown: `## Current state\n${'- Long fact.\n'.repeat(500)}` })
  assert.throws(() => buildCompactionProjection({
    anchorMessages: [], tailMessages: [{ role: 'user', content: 'Continue.' }],
    durableMemory: durableMemoryFixture, packet, retainedContextTokens: 1_000,
  }), /exceed the retention budget/u)
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
    durableMemory: durableMemoryFixture,
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
    durableMemory: durableMemoryFixture,
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
    durableMemory: durableMemoryFixture,
    packet,
    tailMessages,
  })

  const retainedUsers = projected.filter((message) => message.role === 'user' && (
    typeof message.content !== 'string' || !message.content.startsWith('<hidden_user_context')
  ))
  assert.deepEqual(retainedUsers.map((message) => message.content), [
    'Turn 1',
    'Turn 2',
    [{ text: 'Turn 3', type: 'text' }, imagePart],
    'Turn 4',
    'Turn 5',
  ])
})
