import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createCanonicalToolModelOutput,
  normalizeToolExecutionResult,
} from '../../electron/chat/shared/toolReplay'

test('normalizes the AI SDK web search payload to Markdown for the model and UI', () => {
  const output = {
    action: {
      query: 'OpenAI web search result format',
      type: 'search',
    },
    sources: [
      {
        title: 'OpenAI web search documentation',
        type: 'url',
        url: 'https://developers.openai.com/api/docs/guides/tools-web-search',
      },
    ],
  }

  const normalizedResult = normalizeToolExecutionResult('web_search', output)

  assert.equal(normalizedResult.status, 'success')
  assert.equal(
    normalizedResult.body,
    'Searched for OpenAI web search result format\n\n### Sources\n- [OpenAI web search documentation](<https://developers.openai.com/api/docs/guides/tools-web-search>)',
  )
  assert.equal(normalizedResult.displayBody, normalizedResult.body)
  assert.doesNotMatch(normalizedResult.body ?? '', /"sources"/u)

  const modelOutput = createCanonicalToolModelOutput({
    argumentsValue: {},
    output,
    toolCallId: 'call-web-search',
    toolName: 'web_search',
  })

  assert.deepEqual(modelOutput, {
    type: 'text',
    value: normalizedResult.body,
  })
})

test('normalizes a serialized Responses-style web search result to Markdown', () => {
  const normalizedResult = normalizeToolExecutionResult(
    'web_search',
    JSON.stringify([
      {
        action: {
          query: 'Tidecode',
          type: 'search',
        },
        type: 'web_search_call',
      },
      {
        content: [
          {
            annotations: [
              {
                title: 'Tidecode documentation',
                type: 'url_citation',
                url: 'https://example.com/tidecode',
              },
            ],
            text: 'Tidecode result',
            type: 'output_text',
          },
        ],
        type: 'message',
      },
    ]),
  )

  assert.equal(
    normalizedResult.body,
    'Searched for Tidecode\n\n### Sources\n- [Tidecode documentation](<https://example.com/tidecode>)',
  )
})

test('model receives an explicit failure marker without changing stored or UI body', () => {
  const result = { status: 'error' as const, summary: 'File not found', body: 'Missing src/file.ts' }
  const modelOutput = createCanonicalToolModelOutput({
    argumentsValue: { path: 'src/file.ts' },
    output: result,
    toolCallId: 'missing-file',
    toolName: 'read',
  })
  assert.equal(modelOutput.type, 'text')
  if (modelOutput.type !== 'text') return
  assert.match(modelOutput.value, /^Error: /u)
  assert.equal(result.body, 'Missing src/file.ts')
})

test('unstructured JSON results stay readable in UI but compact for the model', () => {
  const output = { status: 'ready', items: [{ name: 'one', value: 1 }] }
  const normalized = normalizeToolExecutionResult('provider_lookup', output)
  assert.equal(normalized.body, JSON.stringify(output))
  assert.equal(normalized.displayBody, JSON.stringify(output, null, 2))
  const modelOutput = createCanonicalToolModelOutput({
    argumentsValue: {},
    output,
    toolCallId: 'raw-object',
    toolName: 'provider_lookup',
  })
  assert.deepEqual(modelOutput, { type: 'text', value: JSON.stringify(output) })
})
