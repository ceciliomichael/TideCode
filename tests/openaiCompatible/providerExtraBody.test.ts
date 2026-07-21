import assert from 'node:assert/strict'
import test from 'node:test'

const { parseExtraBody } = await import('../../electron/providers/extraBody')
const { createExtraBodyFetch } = await import('../../electron/chat/apiKey/requestBody')

test('parseExtraBody accepts DeepSeek thinking configuration', () => {
  assert.deepEqual(
    parseExtraBody('{"thinking":{"type":"enabled"},"reasoning_effort":"high"}'),
    {
      reasoning_effort: 'high',
      thinking: { type: 'enabled' },
    },
  )
})

test('parseExtraBody protects model-owned request fields', () => {
  assert.throws(() => parseExtraBody('{"messages":[]}'), /reserved field "messages"/u)
  assert.throws(() => parseExtraBody('[]'), /must be a JSON object/u)
  assert.throws(() => parseExtraBody('{"constructor":{}}'), /cannot contain the key "constructor"/u)
})

test('createExtraBodyFetch merges provider options without replacing the generated request', async () => {
  let capturedBody = ''
  const mockFetch: typeof fetch = async (_input, init) => {
    capturedBody = typeof init?.body === 'string' ? init.body : ''
    return new Response('{}', { status: 200 })
  }
  const wrappedFetch = createExtraBodyFetch(
    { thinking: { type: 'disabled' } },
    mockFetch,
  )

  await wrappedFetch('https://api.deepseek.com/chat/completions', {
    body: JSON.stringify({ messages: [{ content: 'Hello', role: 'user' }], model: 'deepseek-v4-pro', stream: true }),
    method: 'POST',
  })

  assert.deepEqual(JSON.parse(capturedBody), {
    messages: [{ content: 'Hello', role: 'user' }],
    model: 'deepseek-v4-pro',
    stream: true,
    thinking: { type: 'disabled' },
  })
})
