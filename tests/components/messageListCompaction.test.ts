import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageList } from '../../src/components/MessageList'
import type { ChatCompactionLifecycleState, ChatCompactionMarker, Message } from '../../src/types/chat'

interface RenderTranscriptOptions {
  compactionMarkers?: readonly ChatCompactionMarker[]
  liveCompaction?: ChatCompactionLifecycleState | null
  streamingAssistantMessageId?: string | null
}

function renderTranscript(messages: Message[], options: RenderTranscriptOptions = {}) {
  const previousConsoleError = console.error
  console.error = () => undefined
  try {
    return renderToStaticMarkup(React.createElement(MessageList, {
      compactionMarkers: options.compactionMarkers,
      composerAttachments: [],
      composerValue: '',
      conversationId: 'conversation-1',
      liveCompaction: options.liveCompaction,
      messages,
      onCancelEditingMessage: () => undefined,
      onComposerAttachmentsChange: () => undefined,
      onComposerValueChange: () => undefined,
      onSendEditedMessage: () => undefined,
      sendMessageOnEnter: true,
      streamingAssistantMessageId: options.streamingAssistantMessageId,
    }))
  } finally {
    console.error = previousConsoleError
  }
}

test('live compaction after a finished assistant run renders the answer only once', () => {
  const html = renderTranscript([
    {
      content: 'Hi! How can I help?',
      id: 'assistant-1',
      role: 'assistant',
      timestamp: 1,
    },
  ], {
    liveCompaction: {
      afterMessageId: 'assistant-1',
      attemptId: 'attempt-1',
      phase: 'compacting',
      streamId: 'compact-stream',
    },
  })

  assert.equal(html.match(/Hi! How can I help\?/g)?.length ?? 0, 1)
  assert.equal(html.match(/Compacting/g)?.length ?? 0, 1)
})

test('live compaction stays inside one streaming working block', () => {
  const html = renderTranscript([
    {
      content: 'Pre-compaction assistant work.',
      id: 'assistant-pre',
      reasoningContent: 'Inspecting before compaction.',
      role: 'assistant',
      timestamp: 1_000,
    },
    {
      content: 'Post-compaction assistant work.',
      id: 'assistant-post',
      role: 'assistant',
      timestamp: 4_000,
    },
  ], {
    liveCompaction: {
      afterMessageId: 'assistant-pre',
      attemptId: 'attempt-1',
      phase: 'compacting',
      streamId: 'compact-stream',
    },
    streamingAssistantMessageId: 'assistant-post',
  })

  const preIndex = html.indexOf('Pre-compaction assistant work.')
  const compactingIndex = html.indexOf('Compacting')
  const postIndex = html.indexOf('Post-compaction assistant work.')

  assert.equal(html.match(/Working\.\.\./g)?.length ?? 0, 0)
  assert.equal(html.match(/Worked for/g)?.length ?? 0, 0)
  assert.equal(html.match(/Compacting/g)?.length ?? 0, 1)
  assert.ok(preIndex >= 0)
  assert.ok(preIndex < compactingIndex)
  assert.ok(compactingIndex < postIndex)
})

test('compacting finalizes the active exploration label before the turn finishes', () => {
  const html = renderTranscript([
    {
      content: '',
      id: 'assistant-pre',
      role: 'assistant',
      timestamp: 1_000,
      toolInvocations: [{
        argumentsText: '{"path":"."}',
        id: 'tool-1',
        startedAt: 1_500,
        state: 'running',
        toolName: 'list',
      }],
    },
    {
      content: '',
      id: 'assistant-post',
      role: 'assistant',
      timestamp: 4_000,
    },
  ], {
    liveCompaction: {
      afterMessageId: 'assistant-pre',
      attemptId: 'attempt-1',
      phase: 'compacting',
      streamId: 'compact-stream',
    },
    streamingAssistantMessageId: 'assistant-post',
  })

  assert.equal(html.match(/Exploring/g)?.length ?? 0, 0)
  assert.equal(html.match(/Explored 1 list/g)?.length ?? 0, 1)
  assert.equal(html.match(/Working\.\.\./g)?.length ?? 0, 0)
  assert.equal(html.match(/Worked for/g)?.length ?? 0, 0)
  assert.equal(html.match(/Compacting/g)?.length ?? 0, 1)
})

test('pre-compaction exploration stays finalized after compaction commits', () => {
  const html = renderTranscript([
    {
      content: '',
      id: 'assistant-pre',
      role: 'assistant',
      timestamp: 1_000,
      toolInvocations: [{
        argumentsText: '{"path":"."}',
        id: 'tool-1',
        startedAt: 1_500,
        state: 'running',
        toolName: 'list',
      }],
    },
    {
      content: '',
      id: 'assistant-post',
      role: 'assistant',
      timestamp: 4_000,
    },
  ], {
    liveCompaction: {
      afterMessageId: 'assistant-pre',
      attemptId: 'attempt-1',
      compactionId: 'compaction-1',
      phase: 'compacted',
      streamId: 'compact-stream',
    },
    streamingAssistantMessageId: 'assistant-post',
  })

  assert.equal(html.match(/Exploring/g)?.length ?? 0, 0)
  assert.equal(html.match(/Explored 1 list/g)?.length ?? 0, 1)
  assert.equal(html.match(/Working\.\.\./g)?.length ?? 0, 0)
  assert.equal(html.match(/Worked for/g)?.length ?? 0, 0)
  assert.equal(html.match(/Compacted/g)?.length ?? 0, 1)
})

test('persisted compaction stays inside one collapsed worked block', () => {
  const html = renderTranscript([
    {
      content: 'Release request',
      id: 'user-1',
      role: 'user',
      timestamp: 1_000,
    },
    {
      content: 'Pre-compaction assistant work.',
      id: 'assistant-pre',
      reasoningContent: 'Inspecting before compaction.',
      reasoningCompletedAt: 2_500,
      role: 'assistant',
      timestamp: 2_000,
    },
    {
      content: 'Released successfully.',
      id: 'assistant-post',
      reasoningContent: 'Finishing after compaction.',
      reasoningCompletedAt: 5_000,
      role: 'assistant',
      timestamp: 4_000,
    },
  ], {
    compactionMarkers: [{
      anchorUserMessageId: 'user-1',
      compactionId: 'compaction-1',
      createdAt: 3_000,
      detailSections: [],
    }],
  })

  assert.equal(html.match(/Worked for/g)?.length ?? 0, 1)
  assert.equal(html.match(/Compacted/g)?.length ?? 0, 0)
  assert.equal(html.match(/Released successfully\./g)?.length ?? 0, 1)
})
