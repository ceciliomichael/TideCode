import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateModelMessageContextUsage, estimateMessageContextUsage } from '../../src/lib/contextUsage'
import type { Message } from '../../src/types/chat'
import { estimateModelMessagesTokens } from '../../electron/chat/shared/compaction/budget'

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
