import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveLiveCompactionPlacement } from '../src/components/chat/liveCompactionPlacement'
import type { ChatCompactionLifecycleState, Message } from '../src/types/chat'

const userMessage: Message = {
  content: 'Prompt',
  id: 'user-1',
  role: 'user',
  timestamp: 1,
}
const preCompactionAssistant: Message = {
  content: 'Working before compaction',
  id: 'assistant-pre',
  role: 'assistant',
  timestamp: 2,
}
const postCompactionAssistant: Message = {
  content: '',
  id: 'assistant-post',
  role: 'assistant',
  timestamp: 3,
}

const compactingState: ChatCompactionLifecycleState = {
  afterMessageId: preCompactionAssistant.id,
  attemptId: 'attempt-1',
  phase: 'compacting',
  streamId: 'stream-1',
}

test('live compaction stays after the last pre-compaction transcript message', () => {
  assert.deepEqual(
    resolveLiveCompactionPlacement([userMessage, preCompactionAssistant], compactingState),
    { beforeMessageId: null, trailing: true },
  )
})

test('live compaction moves only into the stable gap before the first post-compaction message', () => {
  assert.deepEqual(
    resolveLiveCompactionPlacement(
      [userMessage, preCompactionAssistant, postCompactionAssistant],
      compactingState,
    ),
    { beforeMessageId: postCompactionAssistant.id, trailing: false },
  )
})

test('missing or legacy boundaries fall back to the transcript tail instead of the streaming draft', () => {
  const state: ChatCompactionLifecycleState = {
    afterMessageId: null,
    attemptId: 'attempt-legacy',
    phase: 'compacting',
    streamId: 'stream-legacy',
  }

  assert.deepEqual(
    resolveLiveCompactionPlacement([userMessage, preCompactionAssistant], state),
    { beforeMessageId: null, trailing: true },
  )
})
