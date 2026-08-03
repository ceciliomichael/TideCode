import assert from 'node:assert/strict'
import test from 'node:test'
import { placeCompactionMarkersAfterTranscript } from '../../src/components/chat/compactionMarkerPlacement'
import type { ChatCompactionMarker, Message } from '../../src/types/chat'

function marker(
  compactionId: string,
  anchorUserMessageId: string | null,
  createdAt = 1,
): ChatCompactionMarker {
  return {
    anchorUserMessageId,
    compactionId,
    createdAt,
    detailSections: [],
  }
}

function message(id: string, role: Message['role'], timestamp = 1): Message {
  return {
    content: '',
    id,
    role,
    timestamp,
  }
}

test('compaction markers are placed before the first transcript message created after compaction', () => {
  const messages = [
    message('user-1', 'user'),
    message('assistant-1', 'assistant', 2),
    message('assistant-2', 'assistant', 4),
    message('user-2', 'user', 5),
  ]

  const placement = placeCompactionMarkersAfterTranscript(messages, [marker('compact-1', 'user-1', 3)])

  assert.deepEqual(placement.markersBeforeMessageId.get('assistant-2')?.map((item) => item.compactionId), ['compact-1'])
  assert.equal(placement.trailingMarkers.length, 0)
})

test('equal or unavailable timestamps fall back to the next user turn', () => {
  const messages = [
    message('user-1', 'user'),
    message('assistant-1', 'assistant'),
    message('user-2', 'user'),
  ]

  const placement = placeCompactionMarkersAfterTranscript(messages, [marker('compact-1', 'user-1')])

  assert.deepEqual(placement.markersBeforeMessageId.get('user-2')?.map((item) => item.compactionId), ['compact-1'])
  assert.equal(placement.trailingMarkers.length, 0)
})

test('the latest compaction marker trails the complete visible transcript', () => {
  const messages = [
    message('user-1', 'user'),
    message('assistant-1', 'assistant'),
    message('assistant-2', 'assistant'),
  ]

  const placement = placeCompactionMarkersAfterTranscript(messages, [marker('compact-1', 'user-1')])

  assert.deepEqual(placement.trailingMarkers.map((item) => item.compactionId), ['compact-1'])
})

test('markers whose anchors are no longer visible trail the transcript safely', () => {
  const placement = placeCompactionMarkersAfterTranscript(
    [message('user-1', 'user')],
    [marker('compact-1', 'missing-user')],
  )

  assert.deepEqual(placement.trailingMarkers.map((item) => item.compactionId), ['compact-1'])
})
