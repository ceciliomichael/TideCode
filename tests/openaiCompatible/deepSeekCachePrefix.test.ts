import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateCacheEfficiency, classifyCacheStep } from '../../electron/chat/cache/diagnostics'
import { normalizeDeepSeekRequestBody } from '../../electron/chat/apiKey/deepSeekWire'
import { shouldReplayAssistantReasoning } from '../../electron/chat/shared/assistantReasoningPolicy'
import { buildModelMessages } from '../../electron/chat/shared/messages'
import type { Message } from '../../src/types/chat'

test('DeepSeek tool-call history rebuilds reasoning_content before serialization', () => {
  const assistantToolTurn: Message = {
    content: '',
    id: 'assistant-1',
    providerId: 'deepseek',
    reasoningContent: 'I should inspect the entry point before editing it.',
    role: 'assistant',
    timestamp: 1,
    toolInvocations: [
      {
        argumentsText: '{"path":"src/main.ts"}',
        id: 'call-1',
        startedAt: 1,
        state: 'completed',
        toolName: 'read',
      },
    ],
  }

  const [modelMessage] = buildModelMessages([assistantToolTurn], {
    includeAssistantReasoningParts: shouldReplayAssistantReasoning('deepseek'),
  })

  assert.equal(shouldReplayAssistantReasoning('deepseek'), true)
  assert.deepEqual(modelMessage, {
    content: [
      {
        text: 'I should inspect the entry point before editing it.',
        type: 'reasoning',
      },
      {
        args: { path: 'src/main.ts' },
        input: { path: 'src/main.ts' },
        toolCallId: 'call-1',
        toolName: 'read',
        type: 'tool-call',
      },
    ],
    role: 'assistant',
  })
})

test('DeepSeek tool loop remains a byte-identical prefix of the following user turn', () => {
  const toolLoopRequest = normalizeDeepSeekRequestBody({
    messages: [
      { content: 'Inspect the project', role: 'user' },
      {
        content: null,
        reasoning_content: 'I should read the entry point.',
        role: 'assistant',
        tool_calls: [
          {
            function: { arguments: '{"path":"src/main.ts"}', name: 'read' },
            id: 'call-1',
            type: 'function',
          },
        ],
      },
      {
        content: 'export function main() {}',
        role: 'tool',
        tool_call_id: 'call-1',
      },
    ],
  })
  const followingTurn = normalizeDeepSeekRequestBody({
    messages: [
      ...(toolLoopRequest.messages as unknown[]),
      {
        content: 'The entry point is straightforward.',
        reasoning_content: 'private final-turn reasoning',
        role: 'assistant',
      },
      { content: 'Now optimize it', role: 'user' },
    ],
  })
  const previousMessages = toolLoopRequest.messages as unknown[]
  const followingPrefix = (followingTurn.messages as unknown[]).slice(0, previousMessages.length)
  assert.equal(JSON.stringify(followingPrefix), JSON.stringify(previousMessages))
  assert.equal(JSON.stringify(followingTurn).includes('private final-turn reasoning'), false)
})

test('DeepSeek preserves oversized tool results at the provider wire boundary', () => {
  const originalToolResult = `head\n${'x'.repeat(30_000)}\ntail`
  const requestBody = {
    messages: [
      { content: 'Inspect the project', role: 'user' },
      { content: originalToolResult, role: 'tool', tool_call_id: 'call-1' },
      { content: 'Final answer', role: 'assistant' },
    ],
  }

  const normalized = normalizeDeepSeekRequestBody(requestBody)
  const normalizedMessages = normalized.messages as Array<Record<string, unknown>>
  const normalizedToolResult = normalizedMessages[1]?.content

  assert.equal(requestBody.messages[1]?.content, originalToolResult)
  assert.equal(normalizedToolResult, originalToolResult)
  assert.equal(normalizedMessages[2]?.content, 'Final answer')
})

test('cache diagnostics report token-weighted and request-weighted hit rates separately', () => {
  const efficiency = calculateCacheEfficiency({
    cacheHitSteps: 2,
    cacheReadTokens: 9_000,
    cacheWriteTokens: 0,
    inputTokens: 10_000,
    noCacheTokens: 1_000,
    outputTokens: 500,
    reasoningTokens: 200,
    stepCount: 4,
    totalDurationMs: 8_000,
    totalTokens: 10_500,
  })
  assert.equal(efficiency.cachedInputRatio, 0.9)
  assert.equal(efficiency.requestHitRate, 0.5)
  assert.equal(efficiency.averageStepDurationMs, 2_000)
  assert.equal(
    classifyCacheStep({
      cacheReadTokens: 64,
      cacheWriteTokens: 0,
      inputTokens: 128,
      noCacheTokens: 64,
      outputTokens: 1,
      reasoningTokens: 0,
      totalTokens: 129,
    }),
    'hit',
  )
})
