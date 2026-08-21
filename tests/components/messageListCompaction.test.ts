import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageList } from '../../src/components/MessageList'
import type { Message } from '../../src/types/chat'

function renderCompactionTranscript(
  messages: Message[],
  streamingAssistantMessageId: string | null = null,
  phase: 'compacting' | 'compacted' = 'compacting',
) {
  const previousConsoleError = console.error
  console.error = () => undefined
  try {
    return renderToStaticMarkup(React.createElement(MessageList, {
      composerAttachments: [],
      composerValue: '',
      conversationId: 'conversation-1',
      liveCompaction: phase === 'compacting'
        ? {
            attemptId: 'attempt-1',
            phase: 'compacting',
            streamId: 'compact-stream',
          }
        : {
            attemptId: 'attempt-1',
            compactionId: 'compact-1',
            phase: 'compacted',
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
  const html = renderCompactionTranscript([
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
  const html = renderCompactionTranscript([
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
  const compactingIndex = html.indexOf('Compacting')

  assert.ok(assistantIndex >= 0)
  assert.ok(compactingIndex >= 0)
  assert.ok(assistantIndex < compactingIndex)
  assert.equal(html.match(/I will read the release instructions first\./g)?.length ?? 0, 1)
  assert.equal(html.includes('Working...'), true)
  assert.equal(html.includes('Worked for'), false)
  assert.equal(html.includes('Explored 1 file'), true)
  assert.equal(html.includes('Exploring'), false)
})

test('persisted compaction stays inside Worked for and counts through compaction', () => {
  const previousConsoleError = console.error
  console.error = () => undefined
  let html = ''
  try {
    html = renderToStaticMarkup(React.createElement(MessageList, {
      compactionMarkers: [{
        anchorUserMessageId: 'user-1',
        compactionId: 'compact-1',
        createdAt: 5000,
        detailSections: [],
      }],
      composerAttachments: [],
      composerValue: '',
      conversationId: 'conversation-1',
      messages: [
        {
          content: 'Please inspect the project.',
          id: 'user-1',
          role: 'user',
          timestamp: 500,
        },
        {
          content: 'I will read the release instructions first.',
          id: 'assistant-pre',
          role: 'assistant',
          timestamp: 1000,
          toolInvocations: [{
            argumentsText: '{"path":"RELEASE_INSTRUCTIONS.md"}',
            completedAt: 3000,
            id: 'tool-call-1',
            resultContent: 'Read RELEASE_INSTRUCTIONS.md (1-200)',
            startedAt: 1500,
            state: 'completed',
            toolName: 'read',
          }],
        },
        {
          content: 'Finished after compaction.',
          id: 'assistant-post',
          role: 'assistant',
          timestamp: 6000,
        },
      ],
      onCancelEditingMessage: () => undefined,
      onComposerAttachmentsChange: () => undefined,
      onComposerValueChange: () => undefined,
      onSendEditedMessage: () => undefined,
      sendMessageOnEnter: true,
    }))
  } finally {
    console.error = previousConsoleError
  }

  assert.equal(html.includes('Worked for 4.00s'), true)
  assert.equal(html.includes('Compacted'), false)
  assert.equal(html.includes('Finished after compaction.'), true)
})

test('compaction stays inside one working block while the assistant resumes', () => {
  const html = renderCompactionTranscript([
    {
      content: 'I will read the release instructions first.',
      id: 'assistant-pre',
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
    {
      content: 'Continuing after compaction.',
      id: 'assistant-post',
      role: 'assistant',
      timestamp: 5,
    },
  ], 'assistant-post', 'compacted')

  const workingIndex = html.indexOf('Working...')
  const preCompactionIndex = html.indexOf('I will read the release instructions first.')
  const compactedIndex = html.indexOf('Compacted')
  const postCompactionIndex = html.indexOf('Continuing after compaction.')

  assert.ok(workingIndex >= 0)
  assert.ok(preCompactionIndex > workingIndex)
  assert.ok(compactedIndex > preCompactionIndex)
  assert.ok(postCompactionIndex > compactedIndex)
  assert.equal(html.match(/Working\.\.\./g)?.length ?? 0, 1)
  assert.equal(html.includes('Worked for'), false)
})
