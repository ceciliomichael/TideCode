import assert from 'node:assert/strict'
import test from 'node:test'
import { splitFinishedAssistantRun } from '../../src/components/chat/assistantWorkGrouping'
import type { Message } from '../../src/types/chat'

function assistantMessage(overrides: Partial<Message>): Message {
  return {
    content: '',
    id: overrides.id ?? 'assistant-1',
    role: 'assistant',
    timestamp: overrides.timestamp ?? 1,
    ...overrides,
  }
}

test('finished work keeps a tool-only final message inside the collapsed group', () => {
  const result = splitFinishedAssistantRun([
    assistantMessage({
      id: 'assistant-reasoning',
      reasoningContent: 'Inspecting the request',
    }),
    assistantMessage({
      id: 'assistant-tool',
      toolInvocations: [
        {
          argumentsText: '{}',
          id: 'tool-1',
          startedAt: 2,
          state: 'completed',
          toolName: 'read',
        },
      ],
      timestamp: 2,
    }),
  ])

  assert.deepEqual(result.workingMessages.map((message) => message.id), [
    'assistant-reasoning',
    'assistant-tool',
  ])
  assert.equal(result.trailingMessage, undefined)
})

test('finished work keeps only the final assistant text outside the collapsed group', () => {
  const result = splitFinishedAssistantRun([
    assistantMessage({
      id: 'assistant-tool',
      toolInvocations: [
        {
          argumentsText: '{}',
          id: 'tool-1',
          startedAt: 1,
          state: 'completed',
          toolName: 'read',
        },
      ],
    }),
    assistantMessage({
      content: 'Here is the result.',
      id: 'assistant-final',
      timestamp: 2,
    }),
  ])

  assert.deepEqual(result.workingMessages.map((message) => message.id), ['assistant-tool'])
  assert.equal(result.trailingMessage?.id, 'assistant-final')
})
