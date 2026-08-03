import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateModelMessageContextUsage, estimateMessageContextUsage } from '../../src/lib/contextUsage'
import type { Message } from '../../src/types/chat'
import { estimateModelMessagesTokens } from '../../electron/chat/shared/compaction/budget'
import { selectContextUsageMessages } from '../../electron/chat/shared/contextUsageProjection'

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

test('context usage does not drop while canonical replay is still missing a completed tool turn', () => {
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

  assert.equal(selected.length, liveMessages.length)
  assert.ok(
    estimateModelMessageContextUsage(selected).totalTokens >
      estimateModelMessageContextUsage(canonicalMessages).totalTokens,
  )
})

test('context usage honors a compacted canonical projection even when raw history is larger', () => {
  const compactedMessages = [
    { content: 'tidecode.compaction_state.v1\nRetained state', role: 'assistant' },
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
