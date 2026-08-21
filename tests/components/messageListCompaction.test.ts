import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageList } from '../../src/components/MessageList'
import type { Message } from '../../src/types/chat'

function renderCompactingTranscript(messages: Message[], streamingAssistantMessageId: string | null = null) {
  const previousConsoleError = console.error
  console.error = () => undefined
  try {
    return renderToStaticMarkup(React.createElement(MessageList, {
      composerAttachments: [],
      composerValue: '',
      conversationId: 'conversation-1',
      liveCompaction: {
        attemptId: 'attempt-1',
        phase: 'compacting',
        streamId: 'compact-stream',
      },
      messages,
      streamingAssistantMessageId,
      onCancelEditingMessage: () => undefined,
      onComposerAttachmentsChange: () => undefined,
      onComposerValueChange: () => undefined,
      onSendEditedMessage: () => undefined,
      sendMessageOnEnter: true,
    }))
  } finally {
    console.error = previousConsoleError
  }
}

test('live compaction after a finished assistant run renders the answer only once', () => {
  const html = renderCompactingTranscript([
    {
      content: 'Hi! How can I help?',
      id: 'assistant-1',
      role: 'assistant',
      timestamp: 1,
    },
  ])

  assert.equal(html.match(/Hi! How can I help\?/g)?.length ?? 0, 1)
  assert.equal(html.match(/Compacting/g)?.length ?? 0, 1)
})

test('live compaction renders completed tool work above the compacting divider', () => {
  const html = renderCompactingTranscript([
    {
      content: 'I will read the release instructions first.',
      id: 'assistant-stream',
      role: 'assistant',
      timestamp: 1,
      toolInvocations: [{
        argumentsText: '{"path":"RELEASE_INSTRUCTIONS.md"}',
        completedAt: 3,
        id: 'tool-call-1',
        resultContent: 'Read RELEASE_INSTRUCTIONS.md (1-200)',
        startedAt: 2,
        state: 'completed',
        toolName: 'read',
      }],
    },
  ], 'assistant-stream')

  const assistantIndex = html.indexOf('I will read the release instructions first.')
  const toolIndex = html.indexOf('RELEASE_INSTRUCTIONS.md')
  const compactingIndex = html.indexOf('Compacting')

  assert.ok(assistantIndex >= 0)
  assert.ok(toolIndex >= 0)
  assert.ok(compactingIndex >= 0)
  assert.ok(assistantIndex < compactingIndex)
  assert.ok(toolIndex < compactingIndex)
})
