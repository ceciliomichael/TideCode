import assert from 'node:assert/strict'
import test from 'node:test'
import { isChatSendBlocked } from '../src/lib/chatSendGate'
import {
  resolveQueuedMessageAutoSendReason,
  shouldProcessQueuedMessages,
  shouldQueueMainMessage,
} from '../src/pages/chatInterface/chatQueueAutoSend'

test('messages submitted during compaction are queued until compaction settles', () => {
  assert.equal(shouldQueueMainMessage({ isCompressingChat: true, isLoading: false, isSending: false }), true)
  assert.equal(shouldQueueMainMessage({ isCompressingChat: false, isLoading: false, isSending: false }), false)
})

test('messages submitted while stopping a response remain queued until cleanup settles', () => {
  assert.equal(
    shouldQueueMainMessage({
      isAbortInProgress: true,
      isCompressingChat: false,
      isLoading: false,
      isSending: false,
    }),
    true,
  )
})

test('queued follow-ups become eligible again after the prior auto-send finishes', () => {
  assert.equal(
    shouldProcessQueuedMessages({
      hasQueuedMessages: true,
      isAutoSendBlocked: false,
      isProcessingQueue: true,
    }),
    false,
  )
  assert.equal(
    shouldProcessQueuedMessages({
      hasQueuedMessages: true,
      isAutoSendBlocked: false,
      isProcessingQueue: false,
    }),
    true,
  )
})

test('steer messages are never started as a separate run while the current turn is active', () => {
  assert.equal(
    resolveQueuedMessageAutoSendReason({
      isTurnActive: true,
    }),
    null,
  )
})

test('queue mode waits until the turn ends', () => {
  assert.equal(
    resolveQueuedMessageAutoSendReason({
      isTurnActive: true,
    }),
    null,
  )
})

test('the complete pending batch releases when the active turn ends', () => {
  assert.equal(
    resolveQueuedMessageAutoSendReason({
      isTurnActive: false,
    }),
    'turn_completed',
  )
})

test('queued sending remains blocked while the runtime ref still reports a send', () => {
  assert.equal(
    isChatSendBlocked({
      actionInFlight: false,
      hasPendingDraftSend: false,
      hasSubmissionInFlight: false,
      isConversationSending: true,
    }),
    true,
  )
})
