import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import { sanitizeModelMessages } from '../../electron/chat/shared/modelMessageIntegrity'
import { hasUnresolvedToolCall } from '../../electron/chat/shared/compaction/window'

test('interrupted tool call is excluded from model-only replay without altering completed exchanges', () => {
  const history = [
    { role: 'user', content: 'Build app' },
    { role: 'assistant', content: [
      { type: 'text', text: 'Inspecting the project.' },
      { type: 'tool-call', toolCallId: 'completed', toolName: 'exec', input: {} },
    ] },
    { role: 'tool', content: [
      { type: 'tool-result', toolCallId: 'completed', toolName: 'exec', output: { type: 'text', value: 'Done' } },
    ] },
    { role: 'assistant', content: [
      { type: 'text', text: 'Continuing the work.' },
      { type: 'tool-call', toolCallId: 'pending', toolName: 'exec', input: {} },
    ] },
  ] as ModelMessage[]
  assert.equal(hasUnresolvedToolCall(history), true)
  const replay = sanitizeModelMessages(history)
  assert.equal(hasUnresolvedToolCall(replay), false)
  assert.equal(history.length, 4)
  assert.match(JSON.stringify(replay), /completed/)
  assert.doesNotMatch(JSON.stringify(replay), /pending/)
  assert.match(JSON.stringify(replay), /Continuing the work/)
})

test('complete tool pairs survive model-context sanitization unchanged', () => {
  const history = [
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'a', toolName: 'exec', input: {} }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'a', toolName: 'exec', output: { type: 'text', value: 'ok' } }] },
  ] as ModelMessage[]
  assert.deepEqual(sanitizeModelMessages(history), history)
})
