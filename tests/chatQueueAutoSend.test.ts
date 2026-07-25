import assert from 'node:assert/strict'
import test from 'node:test'
import {
  detectSuccessfulToolReleaseSignal,
  resolveQueuedMessageAutoSendReason,
} from '../src/pages/chatInterface/chatQueueAutoSend'

test('a tool completion that predates the queued message does not release it', () => {
  assert.equal(
    detectSuccessfulToolReleaseSignal({
      currentSignal: 'tool-1:100',
      hasQueuedMessages: true,
      observedSignal: 'tool-1:100',
    }),
    null,
  )
})

test('the next successful tool completion releases a waiting message', () => {
  assert.equal(
    detectSuccessfulToolReleaseSignal({
      currentSignal: 'tool-2:200',
      hasQueuedMessages: true,
      observedSignal: 'tool-1:100',
    }),
    'tool-2:200',
  )
})

test('tool completions are only captured while a message is queued', () => {
  assert.equal(
    detectSuccessfulToolReleaseSignal({
      currentSignal: 'tool-2:200',
      hasQueuedMessages: false,
      observedSignal: 'tool-1:100',
    }),
    null,
  )
})

test('steer releases after a successful tool once every tool has settled', () => {
  assert.equal(
    resolveQueuedMessageAutoSendReason({
      followUpBehavior: 'steer',
      hasRunningToolInvocations: false,
      hasSuccessfulToolRelease: true,
      isTurnActive: true,
    }),
    'successful_tool',
  )
})

test('steer waits while another tool is still running', () => {
  assert.equal(
    resolveQueuedMessageAutoSendReason({
      followUpBehavior: 'steer',
      hasRunningToolInvocations: true,
      hasSuccessfulToolRelease: true,
      isTurnActive: true,
    }),
    null,
  )
})

test('steer does not release merely because the assistant is between tool calls', () => {
  assert.equal(
    resolveQueuedMessageAutoSendReason({
      followUpBehavior: 'steer',
      hasRunningToolInvocations: false,
      hasSuccessfulToolRelease: false,
      isTurnActive: true,
    }),
    null,
  )
})

test('queue mode ignores successful tools until the turn ends', () => {
  assert.equal(
    resolveQueuedMessageAutoSendReason({
      followUpBehavior: 'queue',
      hasRunningToolInvocations: false,
      hasSuccessfulToolRelease: true,
      isTurnActive: true,
    }),
    null,
  )
})

test('both follow-up modes release when the active turn has ended', () => {
  for (const followUpBehavior of ['queue', 'steer'] as const) {
    assert.equal(
      resolveQueuedMessageAutoSendReason({
        followUpBehavior,
        hasRunningToolInvocations: false,
        hasSuccessfulToolRelease: false,
        isTurnActive: false,
      }),
      'turn_completed',
    )
  }
})
