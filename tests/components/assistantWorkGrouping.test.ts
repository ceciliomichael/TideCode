import assert from 'node:assert/strict'
import test from 'node:test'
import { splitFinishedAssistantRun } from '../../src/components/chat/assistantWorkGrouping'
import type { Message } from '../../src/types/chat'
import { getConversationBranchMessages } from '../../src/lib/chatBranching'

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

for (const work of [
  { reasoningContent: 'Checked the result.' },
  { toolInvocations: [{ id: 'read-1', toolName: 'read', argumentsText: '{}', startedAt: 1, state: 'completed' as const }] },
]) {
  const kind = 'reasoningContent' in work ? 'reasoning' : 'tools'
  test(`final text split from ${kind} branches using the saved message ID`, () => {
    const response = assistantMessage({ id: 'assistant-final-text', content: 'Here is the result.', ...work })
    const transcript: Message[] = [
      { id: 'user-1', role: 'user', content: 'Check this.', timestamp: 0 },
      response,
      { id: 'user-2', role: 'user', content: 'Later request.', timestamp: 2 },
    ]
    const presentation = splitFinishedAssistantRun([response])
    assert.equal(presentation.trailingMessage?.id, response.id)
    assert.notEqual(presentation.workingMessages[0].id, response.id)
    assert.equal(presentation.trailingMessage.reasoningContent, undefined)
    assert.deepEqual(presentation.trailingMessage.toolInvocations, [])
    const branch = getConversationBranchMessages(transcript, presentation.trailingMessage.id)
    assert.deepEqual(branch, transcript.slice(0, 2))
    assert.equal(branch[1], response)
  })
}
