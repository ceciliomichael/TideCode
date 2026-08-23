import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAssistantWorkTimeline } from '../../src/components/chat/assistantWorkTimeline'
import type { ChatCompactionMarker, Message } from '../../src/types/chat'

function assistantMessage(id: string, timestamp: number): Message {
  return { content: '', id, role: 'assistant', timestamp }
}

function marker(): ChatCompactionMarker {
  return {
    anchorUserMessageId: 'user-1',
    compactionId: 'compaction-1',
    createdAt: 3_000,
    detailSections: [],
  }
}

test('assistant work timeline keeps a persisted compaction between pre and post work', () => {
  const result = buildAssistantWorkTimeline(
    [assistantMessage('assistant-pre', 2_000), assistantMessage('assistant-post', 4_000)],
    1,
    [{ afterMessageCount: 1, marker: marker(), type: 'compaction_marker' }],
  )

  assert.deepEqual(result.entries.map((entry) => entry.type), [
    'message',
    'compaction_marker',
    'message',
  ])
  assert.deepEqual(
    result.entries.filter((entry) => entry.type === 'message').map((entry) => entry.index),
    [1, 2],
  )
  assert.deepEqual(result.overflowBoundaries, [])
})

test('assistant work timeline leaves boundaries after removed trailing text outside the work block', () => {
  const boundary = { afterMessageCount: 2, marker: marker(), type: 'compaction_marker' as const }
  const result = buildAssistantWorkTimeline([assistantMessage('assistant-work', 2_000)], 1, [boundary])

  assert.deepEqual(result.entries.map((entry) => entry.type), ['message'])
  assert.deepEqual(result.overflowBoundaries, [boundary])
})
