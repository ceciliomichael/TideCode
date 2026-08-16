import test from 'node:test'
import assert from 'node:assert/strict'
import { CliTurnFollowUpController } from '../../electron/cli/cliTurnFollowUps'

test('follow-up controller preserves queue order and falls back unconsumed steers', () => {
  const controller = new CliTurnFollowUpController('codex', 'missing-test-stream', () => undefined)
  controller.add('steer one', 'steer')
  controller.add('queue two', 'queue')
  controller.add('steer three', 'steer')

  assert.deepEqual(controller.getQueuedTurnInputs(), ['steer one', 'queue two', 'steer three'])
})

test('consumed steers do not execute again as queued turns', () => {
  const controller = new CliTurnFollowUpController('codex', 'missing-test-stream', () => undefined)
  const consumed = controller.add('use this now', 'steer')
  controller.add('do this next', 'queue')
  assert.ok(consumed)

  controller.markConsumed([{
    content: consumed.content,
    id: consumed.id,
    role: 'user',
    timestamp: consumed.timestamp,
    userMessageKind: 'steer',
  }])

  assert.deepEqual(controller.getQueuedTurnInputs(), ['do this next'])
})
