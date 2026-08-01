import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COMPRESSION_ACKNOWLEDGEMENT_TEXT,
  buildCompressedHistoryAcknowledgementMessage,
  buildCompressedHistoryMessage,
  parseCampMemoryPacket,
  parseCompressedHistoryMessage,
} from '../src/lib/chatCompression'
import type { Message } from '../src/types/chat'
import { compressChatHistory } from '../electron/chat/shared/compression'

test('buildCompressedHistoryMessage only returns the compressed context payload', () => {
  const summary = 'Goal\nShip the compression update'

  const message = buildCompressedHistoryMessage(summary)

  assert.ok(message.includes('<tidecode:compressed_history>'))
  assert.ok(message.includes('<tidecode:summary>'))
  assert.ok(!message.includes(COMPRESSION_ACKNOWLEDGEMENT_TEXT))
  assert.deepEqual(parseCompressedHistoryMessage(message), { summary })
})

test('buildCompressedHistoryAcknowledgementMessage creates a synthetic assistant turn', () => {
  const message = buildCompressedHistoryAcknowledgementMessage('message-id', 1234)

  assert.deepEqual(message, {
    content: COMPRESSION_ACKNOWLEDGEMENT_TEXT,
    id: 'message-id',
    role: 'assistant',
    timestamp: 1234,
  })
})

test('compressChatHistory excludes assistant reasoning from transcript and accepts think-wrapped summaries', async () => {
  const messages: Message[] = [
    {
      content: 'Compress this chat',
      id: 'user-1',
      role: 'user',
      timestamp: 1,
    },
    {
      content: '<think>private chain of thought</think>\n\nVisible assistant answer',
      id: 'assistant-1',
      reasoningContent: '<think>private reasoning field</think>',
      role: 'assistant',
      timestamp: 2,
    },
  ]
  const streamedSummary = [
    '<think>',
    'Goal\nKeep useful context',
    'Current State\nVisible answer was given',
    'Done\n- Compression tested',
    'Decisions\n- Exclude hidden reasoning',
    'Open Items\n- None',
    'Key Refs\n- assistant-1',
    'Next Step\nContinue the chat',
    '</think>',
  ].join('\n')
  let transcript = ''

  const summary = await compressChatHistory({
    agentContextRootPath: 'C:/repo',
    chatMode: 'agent',
    createStream: async (input) => {
      const userMessage = input.messages[0]
      if (userMessage?.role === 'user' && typeof userMessage.content === 'string') {
        transcript = userMessage.content
      }

      return {
        fullStream: [
          {
            text: streamedSummary,
            type: 'text-delta',
          },
        ],
      }
    },
    messages,
    modelId: 'test-model',
    reasoningEffort: 'medium',
  })

  assert.equal(summary.includes('<think>'), false)
  assert.equal(summary.includes('</think>'), false)
  assert.match(summary, /Goal\nKeep useful context/u)
  assert.match(transcript, /Visible assistant answer/u)
  assert.equal(transcript.includes('private chain of thought'), false)
  assert.equal(transcript.includes('private reasoning field'), false)
})

test('compressChatHistory trims oversized transcripts before sending them to the model', async () => {
  const hugeUserText = `START OF HUGE TRANSCRIPT ${'A'.repeat(130_000)} END OF HUGE TRANSCRIPT`
  const messages: Message[] = [
    {
      content: hugeUserText,
      id: 'user-1',
      role: 'user',
      timestamp: 1,
    },
    {
      content: 'I inspected the current files and found the likely issue.',
      id: 'assistant-1',
      role: 'assistant',
      timestamp: 2,
    },
    {
      content: 'Please continue from the latest user request.',
      id: 'user-2',
      role: 'user',
      timestamp: 3,
    },
  ]
  let capturedTranscript = ''

  const summary = await compressChatHistory({
    agentContextRootPath: 'C:/repo',
    chatMode: 'agent',
    createStream: async (input) => {
      const userMessage = input.messages[0]
      if (userMessage?.role === 'user' && typeof userMessage.content === 'string') {
        capturedTranscript = userMessage.content
      }

      return {
        fullStream: [
          {
            text: [
              'Goal',
              '- Preserve the latest request',
              '',
              'Current State',
              '- Trimmed transcript was still enough',
              '',
              'Done',
              '- Used the recent conversation tail',
              '',
              'Decisions',
              '- Keep the recent turn',
              '',
              'Open Items',
              '- none',
              '',
              'Key Refs',
              '- none',
              '',
              'Next Step',
              '- Continue the chat',
            ].join('\n'),
            type: 'text-delta',
          },
        ],
      }
    },
    messages,
    modelId: 'test-model',
    reasoningEffort: 'medium',
  })

  assert.match(summary, /Goal\n- Preserve the latest request/u)
  assert.equal(capturedTranscript.includes('START OF HUGE TRANSCRIPT'), false)
  assert.ok(capturedTranscript.includes('END OF HUGE TRANSCRIPT'))
  assert.ok(capturedTranscript.includes('Please continue from the latest user request.'))
})

test('compressChatHistory falls back to a CAMP packet when the model returns no text', async () => {
  const messages: Message[] = [
    {
      content: 'Compress this chat and keep the important work history.',
      id: 'user-1',
      role: 'user',
      timestamp: 1,
    },
    {
      content: 'I checked the workspace and found the likely failing path.',
      id: 'assistant-1',
      role: 'assistant',
      timestamp: 2,
    },
    {
      content: 'Please keep the workspace context and continue from here.',
      id: 'user-2',
      role: 'user',
      timestamp: 3,
    },
  ]

  const summary = await compressChatHistory({
    agentContextRootPath: 'C:/repo',
    chatMode: 'agent',
    createStream: async () => ({
      fullStream: [],
    }),
    messages,
    modelId: 'test-model',
    reasoningEffort: 'medium',
  })

  const parsed = parseCampMemoryPacket(summary)
  assert.ok(parsed)
  assert.equal(parsed?.sections[0]?.name, 'Goal')
  assert.equal(parsed?.sections[parsed.sections.length - 1]?.name, 'Next Step')
  assert.match(summary, /Compress this chat and keep the important work history\./u)
  assert.match(summary, /The compression model returned no visible text/u)
})

test('compressChatHistory does not duplicate persisted tool results in the model transcript', async () => {
  const messages: Message[] = [
    { content: 'Read the file', id: 'user-1', role: 'user', timestamp: 1 },
    {
      content: '',
      id: 'assistant-1',
      role: 'assistant',
      timestamp: 2,
      toolInvocations: [{
        argumentsText: '{"path":"src/app.ts"}',
        completedAt: 3,
        id: 'call-1',
        resultContent: 'UNIQUE TOOL RESULT',
        startedAt: 2,
        state: 'completed',
        toolName: 'read',
      }],
    },
    {
      content: 'UNIQUE TOOL RESULT',
      id: 'tool-1',
      role: 'tool',
      timestamp: 3,
      toolCallId: 'call-1',
    },
  ]
  let transcript = ''

  await compressChatHistory({
    agentContextRootPath: 'C:/repo',
    chatMode: 'agent',
    createStream: async (input) => {
      transcript = String(input.messages[0]?.content ?? '')
      return { fullStream: [] }
    },
    messages,
    modelId: 'test-model',
    reasoningEffort: 'medium',
  })

  assert.equal(transcript.match(/UNIQUE TOOL RESULT/gu)?.length, 1)
})

test('compressChatHistory recovers locally when the compression provider fails', async () => {
  const summary = await compressChatHistory({
    agentContextRootPath: 'C:/repo',
    chatMode: 'agent',
    createStream: async () => {
      throw new Error('provider unavailable')
    },
    messages: [
      { content: 'Keep this goal safe', id: 'user-1', role: 'user', timestamp: 1 },
    ],
    modelId: 'test-model',
    reasoningEffort: 'medium',
  })

  assert.ok(parseCampMemoryPacket(summary))
  assert.match(summary, /Keep this goal safe/u)
})
