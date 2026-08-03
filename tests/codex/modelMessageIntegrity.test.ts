import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import { sanitizeModelMessages } from '../../electron/chat/shared/modelMessageIntegrity'

test('sanitizing replay removes interrupted tool calls while retaining completed calls', () => {
  const messages = [
    { content: 'Inspect the workspace', role: 'user' },
    {
      content: [
        { text: 'I will inspect the workspace.', type: 'text' },
        { input: { path: 'src/complete.ts' }, toolCallId: 'call-complete', toolName: 'read', type: 'tool-call' },
        { input: { path: 'src/interrupted.ts' }, toolCallId: 'call-interrupted', toolName: 'read', type: 'tool-call' },
      ],
      role: 'assistant',
    },
    {
      content: [{ output: { type: 'text', value: 'complete' }, toolCallId: 'call-complete', type: 'tool-result' }],
      role: 'tool',
    },
    { content: 'Continue', role: 'user' },
  ] as ModelMessage[]

  const sanitized = sanitizeModelMessages(messages)
  assert.deepEqual(sanitized.map((message) => message.role), ['user', 'assistant', 'tool', 'user'])

  const assistantContent = sanitized[1]?.role === 'assistant' && Array.isArray(sanitized[1].content)
    ? sanitized[1].content
    : []
  assert.deepEqual(assistantContent.map((part) => part.type), ['text', 'tool-call'])
  assert.equal(assistantContent[1]?.toolCallId, 'call-complete')

  const toolContent = sanitized[2]?.role === 'tool' && Array.isArray(sanitized[2].content)
    ? sanitized[2].content
    : []
  assert.equal(toolContent.length, 1)
  assert.equal(toolContent[0]?.toolCallId, 'call-complete')
})

test('sanitizing replay drops an assistant message that contains only an interrupted tool call', () => {
  const messages = [
    { content: 'Inspect the workspace', role: 'user' },
    {
      content: [{ input: { path: 'src/interrupted.ts' }, toolCallId: 'call-interrupted', toolName: 'read', type: 'tool-call' }],
      role: 'assistant',
    },
    { content: 'Try again', role: 'user' },
  ] as ModelMessage[]

  assert.deepEqual(sanitizeModelMessages(messages).map((message) => message.role), ['user', 'user'])
})
