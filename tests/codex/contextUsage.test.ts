import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateMessageContextUsage } from '../../src/lib/contextUsage'
import type { Message } from '../../src/types/chat'

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
