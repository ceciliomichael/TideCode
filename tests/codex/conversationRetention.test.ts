import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import { retainConversationMessages, retainedMessageTokens, resolveLatestConversationUser } from '../../electron/chat/shared/compaction/conversationRetention'

test('earlier user requirements survive before an oversized newest assistant explanation', () => {
  const messages: ModelMessage[] = [
    { role: 'user', content: 'Preserve keyboard navigation and the approved layout.' },
    { role: 'assistant', content: 'Earlier explanation '.repeat(9_000) },
    { role: 'user', content: 'Use green and add a loading spinner.' },
    { role: 'assistant', content: `Implementation started. ${'Recent explanation '.repeat(3_500)} UI validation remains.` },
  ]
  const retained = retainConversationMessages({ contextMessages: messages, tailMessages: messages.slice(2), maximumTokens: 9_000 })
  assert.deepEqual(retained.filter((message) => message.role === 'user'), [messages[0], messages[2]])
  assert.ok(retainedMessageTokens(retained) <= 9_000)
  const result = String(retained.at(-1)?.content)
  assert.match(result, /Implementation started/u)
  assert.match(result, /UI validation remains/u)
  assert.ok(result.length < String(messages[3].content).length)
})

test('newest user request and attachments remain atomic while earlier oversized intent is omitted', () => {
  const latest: ModelMessage = { role: 'user', content: [
    { type: 'text', text: ' ' },
    { type: 'text', text: '  Keep this exact request.  ' },
    { type: 'image', image: new URL('https://example.test/reference.png') },
  ] }
  const messages: ModelMessage[] = [{ role: 'user', content: 'Older request '.repeat(3_000) }, latest]
  const retained = retainConversationMessages({ contextMessages: messages, tailMessages: [latest], maximumTokens: 5_000 })
  assert.deepEqual(retained, [latest])
  assert.throws(() => retainConversationMessages({ contextMessages: messages, tailMessages: [latest], maximumTokens: 100 }), { reason: 'protected_context_too_large' })
})

test('hidden-only updates are not user intent and stale injections are removed from retained requests', () => {
  const hidden = '<hidden_user_context kind="chat_mode" state="agent">Agent mode</hidden_user_context>'
  const messages: ModelMessage[] = [
    { role: 'user', content: `Keep the approved layout.\n\n${hidden}` },
    { role: 'assistant', content: 'Layout preserved; validation remains.' },
    { role: 'user', content: hidden },
  ]
  assert.deepEqual(resolveLatestConversationUser(messages), { index: 0, message: { role: 'user', content: 'Keep the approved layout.' } })
  const retained = retainConversationMessages({ contextMessages: messages, tailMessages: messages, maximumTokens: 1_000 })
  assert.doesNotMatch(JSON.stringify(retained), /hidden_user_context/u)
  assert.equal(retained.filter((message) => message.role === 'user').length, 1)
})

test('provider-migrated tool-only user envelopes do not replace the actual latest request', () => {
  const request: ModelMessage = { role: 'user', content: 'Check the result before continuing.' }
  const messages: ModelMessage[] = [request, { role: 'user', content: 'Previous tool result:\nTests passed.' }]
  assert.deepEqual(resolveLatestConversationUser(messages), { index: 0, message: request })
})

test('repeated retention stays bounded and keeps corrections in chronological order without status labels', () => {
  let messages: ModelMessage[] = []
  for (let round = 0; round < 40; round += 1) {
    const user: ModelMessage = { role: 'user', content: `Correction ${round}: ${'specific requirement '.repeat(15)}` }
    const assistant: ModelMessage = { role: 'assistant', content: `Result ${round}: verified the requested correction.` }
    messages = retainConversationMessages({ contextMessages: [...messages, user, assistant], tailMessages: [user, assistant], maximumTokens: 1_000 })
    assert.ok(retainedMessageTokens(messages) <= 1_000)
    assert.deepEqual(messages.slice(-2), [user, assistant])
  }
  const users = messages.filter((message) => message.role === 'user')
  assert.ok(users.length < 10)
  assert.match(String(users.at(-1)?.content), /Correction 39/u)
  assert.doesNotMatch(JSON.stringify(messages), /Prompt \d|status.*open/u)
})
