import assert from 'node:assert/strict'
import test from 'node:test'
import { placeCompactionMarkersAfterTranscript } from '../../src/components/chat/compactionMarkerPlacement'
import type { ChatCompactionMarker, Message } from '../../src/types/chat'

function marker(compactionId: string, anchorUserMessageId: string | null): ChatCompactionMarker {
  return {
    anchorUserMessageId,
    compactionId,
    createdAt: 1,
    detailSections: [],
  }
}

function message(id: string, role: Message['role']): Message {
  return {
    content: '',
    id,
    role,
    timestamp: 1,
  }
}

test('compaction markers are placed after the anchored assistant run and before the next user turn', () => {
  const messages = [
    message('user-1', 'user'),
    message('assistant-1', 'assistant'),
    message('user-2', 'user'),
    message('assistant-2', 'assistant'),
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
