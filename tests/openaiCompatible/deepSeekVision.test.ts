import { convertToOpenAICompatibleChatMessages } from '@ai-sdk/openai-compatible/internal'
import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeDeepSeekRequestBody } from '../../electron/chat/apiKey/deepSeekWire'

test('DeepSeek vision images serialize with the documented OpenAI-compatible image_url shape', () => {
  const prompt: Parameters<typeof convertToOpenAICompatibleChatMessages>[0] = [{
    content: [
      { text: 'Inspect this screenshot.', type: 'text' },
      {
        data: { data: 'c2FtcGxl', type: 'data' },
        filename: 'screenshot.png',
        mediaType: 'image/png',
        type: 'file',
      },
    ],
    role: 'user',
  }]

  const messages = convertToOpenAICompatibleChatMessages(prompt)

  assert.deepEqual(messages, [{
    content: [
      { text: 'Inspect this screenshot.', type: 'text' },
      {
        image_url: { url: 'data:image/png;base64,c2FtcGxl' },
        type: 'image_url',
      },
    ],
    role: 'user',
  }])
})

test('DeepSeek vision keeps the reusable text and tool history byte-identical before an image turn', () => {
  const prefix = normalizeDeepSeekRequestBody({
    messages: [
      { content: 'Inspect the workspace', role: 'user' },
      {
        content: null,
        reasoning_content: 'I should read the entry point.',
        role: 'assistant',
        tool_calls: [{
function: { arguments: '{"path":"src/main.ts"}', name: 'read' },
          id: 'call-1',
          type: 'function',
        }],
      },
      { content: 'export function main() {}', role: 'tool', tool_call_id: 'call-1' },
    ],
    model: 'deepseek-v4-flash-vision-exp',
  })

  const visionTurn = normalizeDeepSeekRequestBody({
    messages: [
      ...(prefix.messages as unknown[]),
      {
        content: [
          { text: 'Compare this screenshot with the code.', type: 'text' },
          {
            image_url: { url: 'data:image/png;base64,c2FtcGxl' },
            type: 'image_url',
          },
        ],
        role: 'user',
      },
    ],
    model: 'deepseek-v4-flash-vision-exp',
  })

  const reusablePrefix = prefix.messages as unknown[]
  const nextPrefix = (visionTurn.messages as unknown[]).slice(0, reusablePrefix.length)
  assert.equal(JSON.stringify(nextPrefix), JSON.stringify(reusablePrefix))
  assert.equal(JSON.stringify(visionTurn).includes('data:image/png;base64,c2FtcGxl'), true)
})
