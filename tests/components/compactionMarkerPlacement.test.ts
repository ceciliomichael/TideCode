import assert from 'node:assert/strict'
import test from 'node:test'
import { placeCompactionMarkersAfterTranscript } from '../../src/components/chat/compactionMarkerPlacement'
import { projectHistoryCutoff } from '../../src/hooks/chatHistoryCutoff'
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

test('a marker stays after pre-compaction work until a later message exists', () => {
  const messages = [
    message('user-1', 'user'),
    message('assistant-1', 'assistant'),
  ]

  const placement = placeCompactionMarkersAfterTranscript(messages, [marker('compact-1', 'user-1', 2)])

  assert.equal(placement.markersBeforeMessageId.size, 0)
  assert.deepEqual(placement.trailingMarkers.map((item) => item.compactionId), ['compact-1'])

  const resumedPlacement = placeCompactionMarkersAfterTranscript(
    [...messages, message('assistant-after', 'assistant', 3)],
    [marker('compact-1', 'user-1', 2)],
  )
  assert.deepEqual(resumedPlacement.markersBeforeMessageId.get('assistant-after')?.map((item) => item.compactionId), ['compact-1'])
  assert.equal(resumedPlacement.trailingMarkers.length, 0)
})

test('markers whose anchors were removed by a revert disappear from the transcript', () => {
  const placement = placeCompactionMarkersAfterTranscript(
    [message('user-1', 'user')],
    [marker('compact-1', 'missing-user')],
  )

  assert.deepEqual(placement.trailingMarkers, [])
  assert.deepEqual([...placement.markersBeforeMessageId.entries()], [])
})

test('revert keeps multiple dividers beside their messages rather than stranded under the editor', () => {
  const messages = [
    message('user-1', 'user', 1),
    message('assistant-1', 'assistant', 2),
    message('assistant-after-compact-1', 'assistant', 4),
    message('user-2', 'user', 5),
    message('assistant-2', 'assistant', 6),
    message('assistant-after-compact-2', 'assistant', 8),
  ]
  const markers = [marker('compact-1', 'user-1', 3), marker('compact-2', 'user-2', 7)]
  const reverted = projectHistoryCutoff(messages, 'user-1')
  const placement = placeCompactionMarkersAfterTranscript(reverted.displayMessages, markers)
  assert.deepEqual(reverted.contextMessages.map((entry) => entry.id), ['user-1'])
  assert.deepEqual(placement.markersBeforeMessageId.get('assistant-after-compact-1'), [markers[0]])
  assert.deepEqual(placement.markersBeforeMessageId.get('assistant-after-compact-2'), [markers[1]])
  assert.deepEqual(placement.trailingMarkers, [])
  const canceled = projectHistoryCutoff(messages, null)
  assert.deepEqual(placeCompactionMarkersAfterTranscript(canceled.displayMessages, markers), placement)

  const submitted = projectHistoryCutoff(messages, 'user-1', {
    attachments: [], content: 'Replacement request.', messageId: 'user-1',
  })
  // After the replacement is accepted, canonical branch selection drops both
  // later snapshots; the submitted transcript must not resurrect either one.
  const submittedPlacement = placeCompactionMarkersAfterTranscript(submitted.displayMessages, [])
  assert.deepEqual(submitted.displayMessages.map((entry) => entry.id), ['user-1'])
  assert.equal(submittedPlacement.markersBeforeMessageId.size, 0)
  assert.deepEqual(submittedPlacement.trailingMarkers, [])
})
