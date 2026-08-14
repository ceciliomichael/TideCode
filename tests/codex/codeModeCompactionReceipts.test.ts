import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import { formatStructuredToolResultContent } from '../../src/lib/toolResultContent'
import {
  appendCodeModeReceiptsToSummary,
  extractCodeModeReceipts,
} from '../../electron/chat/shared/compaction/codeModeReceipts'
import { buildCompactionRequestPrompt } from '../../electron/chat/shared/compaction/prompt'
import { compactModelMessages } from '../../electron/chat/shared/compaction/service'
import type { CompactionStreamFactory } from '../../electron/chat/shared/compaction/contracts'

function createCodeModeResultContent() {
  return formatStructuredToolResultContent({
    arguments: { code: "const result = await tools.edit({ path: 'src/app.ts' }); return result" },
    schema: 'tidecode.tool_result/v1',
    semantics: {
      execution_id: 'execution-1',
      operation: 'code_mode',
      tool_call_count: 2,
      tool_calls: [
        {
          name: 'edit',
          status: 'success',
          subject: { kind: 'file', path: 'src/app.ts' },
          summary: 'Edited 1 file successfully',
        },
        {
          name: 'execute_terminal',
          status: 'success',
          subject: { kind: 'session', path: '12345' },
          summary: 'Ran the typecheck successfully',
        },
      ],
    },
    status: 'success',
    subject: { kind: 'code_mode', path: 'local' },
    summary: 'Code Mode completed with 2 tool calls.',
    toolCallId: 'code-mode-1',
    toolName: 'code_mode',
  }, 'Code Mode completed with 2 tool calls.')
}

function createCodeModeMessages(): ModelMessage[] {
  return [
    { role: 'user', content: 'Apply the requested change.' },
    {
      role: 'assistant',
      content: [{
        input: { code: "const result = await tools.edit({ path: 'src/app.ts' }); return result" },
        toolCallId: 'code-mode-1',
        toolName: 'code_mode',
        type: 'tool-call',
      }],
    },
    {
      role: 'tool',
      content: [{
        output: { type: 'text', value: createCodeModeResultContent() },
        toolCallId: 'code-mode-1',
        toolName: 'code_mode',
        type: 'tool-result',
      }],
    },
    { role: 'assistant', content: 'The requested change is complete.' },
    { role: 'user', content: 'Continue with verification.' },
    { role: 'assistant', content: 'Ready for verification.' },
  ]
}

function createStream(summary: string): CompactionStreamFactory {
  return async () => ({
    fullStream: (async function* () {
      yield { text: summary, type: 'text-delta' }
    })(),
  })
}

test('Code Mode receipts expose nested completion evidence independently of the long result body', () => {
  const messages = createCodeModeMessages()
  const receipts = extractCodeModeReceipts(messages)

  assert.equal(receipts.length, 1)
  assert.equal(receipts[0]?.status, 'success')
  assert.equal(receipts[0]?.nestedToolCalls.length, 2)
  assert.match(receipts[0]?.nestedToolCalls[0]?.summary ?? '', /Edited 1 file/u)
  assert.match(
    appendCodeModeReceiptsToSummary('## Summary\n- Continue safely.', messages),
    /Verified Code Mode executions[\s\S]*edit succeeded[\s\S]*src\/app\.ts/u,
  )
})

test('compaction keeps Code Mode receipts when the original outer exchange is evicted', async () => {
  const result = await compactModelMessages({
    createStream: createStream('## Summary\n- Continue from the verified state.'),
    force: true,
    messages: createCodeModeMessages(),
    model: 'test-model',
    reasoningEffort: 'low',
    systemPromptTokens: 100,
    toolSchemaTokens: 100,
  })

  assert.ok(result)
  assert.match(result.packet.continuationMarkdown, /Verified Code Mode executions/u)
  assert.match(result.packet.continuationMarkdown, /edit succeeded/u)
  assert.match(result.packet.continuationMarkdown, /Ran the typecheck successfully/u)
  assert.equal(result.projectedMessages.some((message) => message.role === 'tool'), false)
})

test('repeated compaction carries prior Code Mode receipts forward', async () => {
  const first = await compactModelMessages({
    createStream: createStream('## Summary\n- The first verified change is complete.'),
    force: true,
    messages: createCodeModeMessages(),
    model: 'test-model',
    reasoningEffort: 'low',
    systemPromptTokens: 100,
    toolSchemaTokens: 100,
  })
  assert.ok(first)

  const second = await compactModelMessages({
    createStream: createStream('## Summary\n- Continue with the next verified step.'),
    force: true,
    messages: [
      ...first.projectedMessages,
      { role: 'user', content: 'Now inspect the final state.' },
      { role: 'assistant', content: 'The final state is ready.' },
    ],
    model: 'test-model',
    previousPacket: first.packet,
    reasoningEffort: 'low',
    systemPromptTokens: 100,
    toolSchemaTokens: 100,
  })

  assert.ok(second)
  assert.match(second.packet.continuationMarkdown, /Verified Code Mode executions/u)
  assert.match(second.packet.continuationMarkdown, /Edited 1 file successfully/u)
})

test('compaction prompt labels Code Mode receipts as evidence instead of pending instructions', () => {
  const prompt = buildCompactionRequestPrompt({
    messages: createCodeModeMessages().slice(0, 4),
    sourceDigest: 'code-mode-receipt-digest',
    sourceMessageIds: ['model:0', 'model:1', 'model:2', 'model:3'],
  })

  assert.match(prompt, /VERIFIED CODE MODE RECEIPTS/u)
  assert.match(prompt, /preserve their completed or failed status/u)
  assert.match(prompt, /Ran the typecheck successfully/u)
})
