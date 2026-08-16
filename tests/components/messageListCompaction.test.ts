import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageList } from '../../src/components/MessageList'
import type { Message } from '../../src/types/chat'

function renderCompactingTranscript(messages: Message[]) {
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
