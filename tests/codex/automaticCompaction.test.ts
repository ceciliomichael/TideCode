import assert from 'node:assert/strict'
import '../configureAppRoot'
import test from 'node:test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { electronApp } from '../../electron/electronApp'
import { runToolEnabledChatStream } from '../../electron/chat/shared/runtime'
import { ChatStreamSteeringController } from '../../electron/chat/shared/streamSteering'
import { shutdownTerminalBroker } from '../../electron/terminal/broker/instance'
import type { ChatStreamEvent } from '../../src/types/chat'
import { temporaryImageScenario } from '../fixtures/contextCompactionScenarios'
import type { ModelMessage } from 'ai'
import {
  resolveAutomaticCompactionMessages,
  resolveAutomaticCompactionTrigger,
} from '../../electron/chat/shared/compaction/automatic'
import {
  calculateModelMessagesBudget,
  shouldCompactContext,
} from '../../electron/chat/shared/compaction/budget'

const completedToolStep: ModelMessage[] = [
  {
    role: 'assistant',
    content: [{
      input: { path: 'src/app.ts' },
      toolCallId: 'call-1',
      toolName: 'read_file',
      type: 'tool-call',
    }],
  },
  {
    role: 'tool',
    content: [{
      output: { type: 'text', value: 'file contents' },
      toolCallId: 'call-1',
      toolName: 'read_file',
      type: 'tool-result',
    }],
  },
]

test('runtime counts a temporary image in the dispatched request and completes without a maintenance compaction', { timeout: 15_000 }, async () => {
  const isolatedHome = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-request-integration-'))
  const originalGetPath = electronApp.getPath
  electronApp.getPath = () => isolatedHome
  const events: ChatStreamEvent[] = []
  let dispatches = 0
  try {
    await runToolEnabledChatStream({
      abortController: new AbortController(),
      streamId: 'integration-stream', steering: new ChatStreamSteeringController(),
      webContents: { emit: (event) => events.push(event) },
      startInput: {
        agentContextRootPath: isolatedHome, conversationId: 'request-integration', chatMode: 'agent',
        contextCompaction: { contextWindowTokens: 256_000, retainedContextTokens: 10_000, triggerPercent: 80 },
        messages: [{ id: 'user', role: 'user', content: 'Inspect the image.', timestamp: 1 }],
        providerId: 'codex', modelId: 'unknown', reasoningEffort: 'low', terminalExecutionMode: 'sandbox',
      },
      createStream: async (streamInput) => {
        dispatches += 1
        const prepared = await streamInput.prepareStep!({
          messages: [...streamInput.messages, temporaryImageScenario()],
          responseMessages: [], steps: [], stepNumber: 0,
        } as Parameters<NonNullable<typeof streamInput.prepareStep>>[0])
        assert.equal(prepared?.maxOutputTokens, streamInput.maxOutputTokens)
        assert.ok(prepared?.messages?.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'file')))
        return { fullStream: (async function* () {
          await streamInput.onStepEnd?.({
            finishReason: 'stop', responseMessages: [{ role: 'assistant', content: 'Image inspected.' }],
            stepNumber: 0, durationMs: 1, providerMetadata: null,
            usage: { inputTokens: 8_000, outputTokens: 10, totalTokens: 8_010, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, noCacheTokens: 8_000 },
          })
          yield { type: 'text-delta', text: 'Image inspected.' }
          yield { type: 'finish', finishReason: 'stop' }
        })() }
      },
    })
    assert.equal(dispatches, 1)
    assert.ok(events.some((event) => event.type === 'context_usage_updated' && event.usage.scope === 'next_request' && event.usage.imageTokens === 4_096))
    assert.ok(events.some((event) => event.type === 'completed'))
    assert.equal(events.some((event) => event.type === 'error' || event.type === 'compaction_started'), false)
  } finally {
    await shutdownTerminalBroker()
    electronApp.getPath = originalGetPath
    assert.equal(path.dirname(isolatedHome), path.resolve(tmpdir()))
    await fs.rm(isolatedHome, { recursive: true, force: true })
  }
})

test('automatic compaction is eligible before a new user turn', () => {
  assert.equal(resolveAutomaticCompactionTrigger({
    messages: [{ role: 'user', content: 'Continue the task.' }],
    responseMessages: [],
    stepNumber: 0,
  }), 'user_turn')
})

test('automatic compaction is eligible after a completed tool result', () => {
  assert.equal(resolveAutomaticCompactionTrigger({
    messages: completedToolStep,
    responseMessages: completedToolStep,
    stepNumber: 1,
  }), 'tool_result')
})

test('automatic compaction remains eligible for a non-tool continuation boundary', () => {
  assert.equal(resolveAutomaticCompactionTrigger({
    messages: [{ role: 'assistant', content: 'Continue.' }],
    responseMessages: [{ role: 'assistant', content: 'Continue.' }],
    stepNumber: 1,
  }), 'model_step')
})

test('automatic compaction detects a tool result even when a provider appends a message', () => {
  const messages = [
    ...completedToolStep,
    { role: 'assistant', content: 'I am continuing after the tool result.' } satisfies ModelMessage,
  ]

  assert.equal(resolveAutomaticCompactionTrigger({
    messages,
    responseMessages: messages,
    stepNumber: 1,
  }), 'tool_result')
})

test('automatic compaction uses the exact AI SDK current-step message state', () => {
  const currentStepMessages: ModelMessage[] = [
    { role: 'user', content: 'Inspect the workspace.' },
    ...completedToolStep,
  ]

  assert.deepEqual(
    resolveAutomaticCompactionMessages({
      messages: currentStepMessages,
      responseMessages: completedToolStep,
    }),
    currentStepMessages,
  )
})

test('automatic compaction does not cross the threshold by re-appending accumulated responses', () => {
  const currentStepMessages: ModelMessage[] = [
    { role: 'user', content: 'H'.repeat(600_000) },
  ]
  const accumulatedResponses: ModelMessage[] = [
    { role: 'assistant', content: 'R'.repeat(80_000) },
  ]
  const providerMessages = resolveAutomaticCompactionMessages({
    messages: currentStepMessages,
    responseMessages: accumulatedResponses,
  })
  const actualBudget = calculateModelMessagesBudget({
    contextWindowTokens: 200_000,
    messages: providerMessages,
    systemPromptTokens: 0,
    toolSchemaTokens: 0,
    triggerRatio: 0.8,
  })
  const incorrectlyInflatedBudget = calculateModelMessagesBudget({
    contextWindowTokens: 200_000,
    messages: [...providerMessages, ...accumulatedResponses],
    systemPromptTokens: 0,
    toolSchemaTokens: 0,
    triggerRatio: 0.8,
  })

  assert.deepEqual(providerMessages, currentStepMessages)
  assert.equal(shouldCompactContext(actualBudget), false)
  assert.equal(shouldCompactContext(incorrectlyInflatedBudget), true)
})

test('automatic compaction does not resurrect response history removed by a persisted message override', () => {
  const compactedMessages: ModelMessage[] = [
    { role: 'user', content: 'Continue the task.' },
    { role: 'assistant', content: 'Compacted continuation state.' },
  ]
  const preCompactionResponses: ModelMessage[] = [
    { role: 'assistant', content: 'A large historical response.' },
    ...completedToolStep,
  ]

  assert.deepEqual(
    resolveAutomaticCompactionMessages({
      messages: compactedMessages,
      responseMessages: preCompactionResponses,
    }),
    compactedMessages,
  )
})

test('automatic compaction is cancelled when the run is aborted', () => {
  const controller = new AbortController()
  controller.abort()

  assert.equal(resolveAutomaticCompactionTrigger({
    abortSignal: controller.signal,
    messages: completedToolStep,
    responseMessages: completedToolStep,
    stepNumber: 1,
  }), null)
})
