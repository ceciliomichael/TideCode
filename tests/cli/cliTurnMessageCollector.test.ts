import test from 'node:test'
import assert from 'node:assert/strict'
import { CliTurnMessageCollector } from '../../electron/cli/cliTurnMessageCollector'
import type { CliSessionState } from '../../electron/cli/types'

function createState(): CliSessionState {
  return {
    activeStreamId: 'stream-1',
    chatMode: 'agent',
    conversationId: 'conversation-1',
    isStreaming: true,
    messages: [],
    modelId: 'gpt-test',
    providerId: 'openai',
    reasoningEffort: 'high',
    terminalExecutionMode: 'full',
    workspaceRootPath: 'C:/workspace',
  }
}

test('CLI collector exposes a live desktop-compatible projection while the turn is running', () => {
  const projections: CliSessionState['messages'][] = []
  const runtimePatches: Array<{ streamingAssistantMessageId?: string | null; streamingWaitingIndicatorVariant?: string | null }> = []
  let textPulseCount = 0
  let textStopCount = 0
  const collector = new CliTurnMessageCollector(createState(), {
    onConversationRuntimeStateUpdated: (patch) => runtimePatches.push(patch),
    onProjectionUpdated: (messages) => projections.push(messages),
    onTextStreamingPulse: () => { textPulseCount += 1 },
    onTextStreamingStopped: () => { textStopCount += 1 },
  })

  const placeholder = projections.at(-1)?.at(-1)
  assert.equal(placeholder?.role, 'assistant')
  assert.equal(placeholder?.content, '')
  assert.equal(runtimePatches.at(-1)?.streamingAssistantMessageId, placeholder?.id)
  assert.equal(runtimePatches.at(-1)?.streamingWaitingIndicatorVariant, 'thinking')

  collector.handleEvent({ delta: 'Still reasoning live', streamId: 'stream-1', type: 'reasoning_delta' })
  const liveReasoning = projections.at(-1)?.at(-1)
  assert.equal(liveReasoning?.reasoningContent, 'Still reasoning live')
  assert.ok(textPulseCount > 0)

  collector.handleEvent({
    argumentsText: '{"path":"README.md"}',
    invocationId: 'tool-live',
    startedAt: 20,
    streamId: 'stream-1',
    toolName: 'read',
    type: 'tool_invocation_started',
  })
  const liveToolMessage = projections.at(-1)?.find((message) =>
    message.role === 'assistant' && message.toolInvocations?.some((tool) => tool.id === 'tool-live'),
  )
  assert.equal(liveToolMessage?.toolInvocations?.[0]?.state, 'running')
  assert.ok(textStopCount > 0)

  collector.handleEvent({ streamId: 'stream-1', type: 'completed' })
  collector.finalize()
  assert.equal(runtimePatches.at(-1)?.streamingAssistantMessageId, null)
})

test('CLI collector produces desktop-compatible rich assistant and tool messages', () => {
  const collector = new CliTurnMessageCollector(createState())
  collector.handleEvent({ delta: 'Inspecting the workspace', streamId: 'stream-1', type: 'reasoning_delta' })
  collector.handleEvent({ streamId: 'stream-1', type: 'reasoning_completed' })
  collector.handleEvent({
    argumentsText: '{"path":"README.md"}',
    invocationId: 'tool-1',
    startedAt: 20,
    streamId: 'stream-1',
    toolName: 'read',
    type: 'tool_invocation_started',
  })
  const syntheticMessage = {
    content: 'tool result',
    id: 'tool-message-1',
    role: 'tool' as const,
    timestamp: 21,
    toolCallId: 'tool-1',
  }
  collector.handleEvent({
    argumentsText: '{"path":"README.md"}',
    completedAt: 21,
    invocationId: 'tool-1',
    resultContent: 'README contents',
    streamId: 'stream-1',
    syntheticMessage,
    toolName: 'read',
    type: 'tool_invocation_completed',
  })
  collector.handleEvent({ delta: 'The project is ready.', streamId: 'stream-1', type: 'content_delta' })
  collector.handleEvent({ streamId: 'stream-1', type: 'completed' })

  const messages = collector.finalize()
  const assistantMessages = messages.filter((message) => message.role === 'assistant')
  assert.equal(assistantMessages[0]?.reasoningContent, 'Inspecting the workspace')
  assert.equal(assistantMessages[0]?.modelId, 'gpt-test')
  assert.equal(assistantMessages[0]?.providerId, 'openai')
  assert.equal(assistantMessages[0]?.reasoningEffort, 'high')
  assert.equal(assistantMessages[1]?.toolInvocations?.[0]?.id, 'tool-1')
  assert.equal(assistantMessages.at(-1)?.content, 'The project is ready.')
  assert.ok(messages.some((message) => message.id === syntheticMessage.id && message.role === 'tool'))
})
