import assert from 'node:assert/strict'
import test from 'node:test'
import { getVisibleChatCompactionMarkers } from '../src/lib/chatCompactionMarkerState'
import type { ChatCompactionMarker } from '../src/types/chat'

function marker(compactionId: string): ChatCompactionMarker {
  return {
    anchorUserMessageId: null,
    compactionId,
    createdAt: 1,
    detailSections: [],
  }
}

test('conversation switching never exposes the previous conversation markers', () => {
  const chatOneMarker = marker('chat-one-compaction')
  const chatTwoMarker = marker('chat-two-compaction')
  const markersByConversation = new Map([
    ['chat-1', [chatOneMarker]],
    ['chat-2', [chatTwoMarker]],
  ])

  assert.deepEqual(
    getVisibleChatCompactionMarkers(
      { conversationId: 'chat-1', markers: [chatOneMarker] },
      markersByConversation,
      'chat-2',
    ),
    [chatTwoMarker],
  )
})

test('an uncached conversation renders without any stale compaction markers while loading', () => {
  const markers = getVisibleChatCompactionMarkers(
    { conversationId: 'chat-1', markers: [marker('chat-one-compaction')] },
    new Map(),
    'chat-2',
  )

  assert.deepEqual(markers, [])
})
