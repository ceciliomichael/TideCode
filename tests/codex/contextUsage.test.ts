import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateModelMessageContextUsage, estimateMessageContextUsage } from '../../src/lib/contextUsage'
import type { Message } from '../../src/types/chat'
import {
  calculateModelMessagesBudget,
  estimateModelMessagesTokens,
  shouldCompactContext,
} from '../../electron/chat/shared/compaction/budget'
import { selectContextUsageMessages } from '../../electron/chat/shared/contextUsageProjection'
import { MODEL_IMAGE_TOKEN_ALLOWANCE } from '../../src/lib/contextUsage'

test('context usage counts tool arguments and separates tool result tokens', () => {
  const messages: Message[] = [
    {
      content: 'Inspect the file',
      id: 'user',
      role: 'user',
      timestamp: 1,
    },
    {
      content: '',
      id: 'assistant',
      role: 'assistant',
      timestamp: 2,
      toolInvocations: [{
        argumentsText: '{"path":"src/app.ts"}',
        completedAt: 3,
        id: 'call-1',
        resultContent: 'contents',
        startedAt: 2,
        state: 'completed',
        toolName: 'read',
      }],
    },
    {
      content: 'tool result body',
      id: 'tool',
      role: 'tool',
      timestamp: 3,
      toolCallId: 'call-1',
    },
  ]

  const usage = estimateMessageContextUsage(messages)
  assert.ok(usage.historyTokens > 0)
  assert.ok(usage.toolResultsTokens > 0)
  assert.equal(usage.totalTokens, usage.historyTokens + usage.toolResultsTokens)
})

test('automatic compaction uses the same model-content token estimate as the context indicator', () => {
  const messages = [
    { role: 'user', content: 'A'.repeat(8_000) },
    {
      role: 'tool',
      content: [{
        output: { type: 'text', value: 'B'.repeat(12_000) },
        toolCallId: 'call-1',
        toolName: 'read_file',
        type: 'tool-result',
      }],
    },
  ] as const

  assert.equal(
    estimateModelMessagesTokens(messages),
    estimateModelMessageContextUsage(messages).totalTokens,
  )
})

test('model context usage treats base64 image bytes as image input instead of text tokens', () => {
  const smallPayloadMessages = [{
    role: 'user',
    content: [{
      image: `data:image/png;base64,${'A'.repeat(128)}`,
      mediaType: 'image/png',
      type: 'image',
    }],
  }] as const
  const largePayloadMessages = [{
    role: 'user',
    content: [{
      image: `data:image/png;base64,${'A'.repeat(1_000_000)}`,
      mediaType: 'image/png',
      type: 'image',
    }],
  }] as const

  const smallUsage = estimateModelMessageContextUsage(smallPayloadMessages)
  const largeUsage = estimateModelMessageContextUsage(largePayloadMessages)

  assert.equal(largeUsage.totalTokens, smallUsage.totalTokens)
  assert.ok(largeUsage.totalTokens >= MODEL_IMAGE_TOKEN_ALLOWANCE)
  assert.ok(largeUsage.totalTokens < MODEL_IMAGE_TOKEN_ALLOWANCE + 100)
})

test('model context usage also bounds images returned by tools as file parts', () => {
  const createMessages = (size: number) => [{
    role: 'tool',
    content: [{
      output: {
        type: 'content',
        value: [{
          type: 'file',
          data: { type: 'data', data: new Uint8Array(size) },
          mediaType: 'image/png',
        }],
      },
      toolCallId: 'read-image',
      toolName: 'read',
      type: 'tool-result',
    }],
  }] as const

  assert.equal(
    estimateModelMessageContextUsage(createMessages(1_000_000)).totalTokens,
    estimateModelMessageContextUsage(createMessages(10)).totalTokens,
  )
})

test('the compaction budget triggers at the configured context percentage', () => {
  const messages = [
    { role: 'user', content: 'U'.repeat(96_000) },
    {
      role: 'assistant',
      content: [{
        input: { path: 'package.json' },
        toolCallId: 'call-1',
        toolName: 'read_file',
        type: 'tool-call',
      }],
    },
    {
      role: 'tool',
      content: [{
        output: { type: 'text', value: 'T'.repeat(528_000) },
        toolCallId: 'call-1',
        toolName: 'read_file',
        type: 'tool-result',
      }],
    },
  ] as const

  const budget = calculateModelMessagesBudget({
    contextWindowTokens: 200_000,
    messages,
    systemPromptTokens: 5_700,
    toolSchemaTokens: 0,
    triggerRatio: 0.8,
  })

  assert.equal(budget.triggerTokens, 160_000)
  assert.ok(budget.totalTokens >= budget.triggerTokens)
  assert.equal(shouldCompactContext(budget), true)
})

test('context usage follows the provider replay instead of stale raw tool entries', () => {
  const canonicalMessages = [
    { content: 'Earlier conversation'.repeat(4_000), role: 'user' },
  ] as const
  const liveMessages = [
    ...canonicalMessages,
    { content: 'Run the terminal command.', role: 'user' },
    {
      content: [{ type: 'tool-call', input: { command: 'npm test' }, toolCallId: 'call-1', toolName: 'execute_terminal' }],
      role: 'assistant',
    },
    {
      content: [{
        output: { type: 'text', value: 'terminal output '.repeat(4_000) },
        toolCallId: 'call-1',
        toolName: 'execute_terminal',
        type: 'tool-result',
      }],
      role: 'tool',
    },
    { content: 'The command completed.', role: 'assistant' },
  ] as const

  const selected = selectContextUsageMessages({
    canonicalMessages,
    fallbackMessages: liveMessages,
    isCompacted: false,
  })

  assert.deepEqual(selected, [...canonicalMessages])
  assert.equal(
    estimateModelMessageContextUsage(selected).totalTokens,
    estimateModelMessageContextUsage(canonicalMessages).totalTokens,
  )
})

test('context usage honors a compacted canonical projection even when raw history is larger', () => {
  const compactedMessages = [
    { content: 'The verified continuation context is retained here.', role: 'assistant' },
  ] as const
  const rawMessages = [
    ...compactedMessages,
    { content: 'Raw historical tool output '.repeat(10_000), role: 'tool' },
  ] as const

  const selected = selectContextUsageMessages({
    canonicalMessages: compactedMessages,
    fallbackMessages: rawMessages,
    isCompacted: true,
  })

  assert.equal(selected.length, compactedMessages.length)
})
