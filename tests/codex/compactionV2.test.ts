import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import {
  buildContinuationMessage,
  repairCompactionPacketContinuation,
  validateContinuationMarkdown,
} from '../../electron/chat/shared/compaction/markdown'
import { buildFallbackCompactionPacket } from '../../electron/chat/shared/compaction/fallback'
import { buildCompactionProjection } from '../../electron/chat/shared/compaction/projection'
import {
  extractActionLinkedReasoning,
  mergeCompactionPacketState,
  resolveProviderReasoningCapability,
  resolveReasoningRetention,
} from '../../electron/chat/shared/compaction/reasoning'
import { derivePromptCacheKey } from '../../electron/chat/cache/providerPolicies'
import { buildCompactionRequestPrompt } from '../../electron/chat/shared/compaction/prompt'

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
  const packet = buildFallbackCompactionPacket({
    messages: [{ role: 'user', content: 'Preserve the verified release state.' }],
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
  const previous = buildFallbackCompactionPacket({
    messages: [{ role: 'user', content: 'Keep the provider cache prefix stable.' }],
    modelId: 'deepseek-v4-pro',
    providerId: 'deepseek',
    sourceDigest: 'digest-1',
    sourceMessageIds: ['model:0'],
  })
  const current = buildFallbackCompactionPacket({
    messages: [{ role: 'user', content: 'Validate DeepSeek reasoning replay.' }],
    modelId: 'deepseek-v4-pro',
    providerId: 'deepseek',
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
  const previous = buildFallbackCompactionPacket({
    messages: [{ role: 'user', content: 'Implement the compaction state ledger.' }],
    modelId: 'test-model',
    sourceDigest: 'digest-previous-status',
    sourceMessageIds: ['model:0'],
  })
  const current = buildFallbackCompactionPacket({
    messages: [{ role: 'assistant', content: 'The compaction state ledger was implemented and verified.' }],
    modelId: 'test-model',
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
  const previous = buildFallbackCompactionPacket({
    messages: [{ role: 'user', content: 'Keep the existing provider behavior.' }],
    modelId: 'test-model',
    sourceDigest: 'digest-previous',
    sourceMessageIds: ['model:0'],
  })
  const generatedMarkdown = 'The release metadata change is complete. The next step is to run the whitespace check.'
  const current = buildFallbackCompactionPacket({
    messages: [{ role: 'user', content: 'Run the release validation.' }],
    modelId: 'test-model',
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

test('projection emits one Markdown continuation and keeps a complete tool interaction in the semantic tail', () => {
  const packet = buildFallbackCompactionPacket({
    messages: [{ role: 'user', content: 'Inspect the workspace.' }],
    modelId: 'test-model',
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
  assert.deepEqual(projected.slice(-3), [toolCall, toolResult, { role: 'assistant', content: 'The result is ready.' }])
  assert.equal(projected.some((message) => typeof message.content === 'string' && message.content.includes('tidecode.compaction_packet/v2')), false)
})

test('projection converts image placeholders into provider-valid text parts', () => {
  const packet = buildFallbackCompactionPacket({
    messages: [{ role: 'user', content: 'Inspect the screenshot.' }],
    modelId: 'test-model',
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
  const packet = buildFallbackCompactionPacket({
    messages: [{ role: 'user', content: 'Keep the recent visual context.' }],
    modelId: 'test-model',
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
