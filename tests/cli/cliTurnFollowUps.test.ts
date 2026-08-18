import test from 'node:test'
import assert from 'node:assert/strict'
import type { SharedFollowUpSnapshot, UpdateSharedFollowUpsInput } from '../../src/types/chat'
import { CliTurnFollowUpController } from '../../electron/cli/cliTurnFollowUps'

test('follow-up controller publishes queue and steer messages through the shared run service', () => {
  const updates: UpdateSharedFollowUpsInput[] = []
  const controller = new CliTurnFollowUpController(
    'codex',
    'test-stream',
    (input) => { updates.push(input) },
    async () => [],
  )

  const steer = controller.add('steer one', 'steer')
  const queued = controller.add('queue two', 'queue')
  assert.ok(steer)
  assert.ok(queued)

  assert.deepEqual(updates.map((update) => ({
    behavior: update.mutation.type === 'add' ? update.mutation.item.behavior : null,
    content: update.mutation.type === 'add' ? update.mutation.item.message.content : null,
    streamId: update.streamId,
  })), [
    { behavior: 'steer', content: 'steer one', streamId: 'test-stream' },
    { behavior: 'queue', content: 'queue two', streamId: 'test-stream' },
  ])
})

test('follow-up controller mirrors shared snapshots from another surface', () => {
  const controller = new CliTurnFollowUpController('codex', 'test-stream', () => undefined, async () => [])
  const snapshot: SharedFollowUpSnapshot = {
    conversationId: 'conversation-1',
    items: [
      { behavior: 'steer', message: { content: 'desktop steer', id: 'steer-1', timestamp: 1 } },
      { behavior: 'queue', message: { content: 'desktop queue', id: 'queue-1', timestamp: 2 } },
    ],
    revision: 2,
    runId: 'run-1',
    streamId: 'test-stream',
  }

  controller.applySnapshot(snapshot)
  controller.markConsumed([{
    content: 'desktop steer',
    id: 'steer-1',
    role: 'user',
    timestamp: 1,
    userMessageKind: 'steer',
  }])

  assert.deepEqual(controller.getQueuedTurnMessages().map((message) => message.content), ['desktop queue'])
})

test('follow-up controller claims the shared queue once for the next turn', async () => {
  const claimed = [{ content: 'next turn', id: 'queue-1', timestamp: 1 }]
  let claimCount = 0
  const controller = new CliTurnFollowUpController(
    'codex',
    'test-stream',
    () => undefined,
    async () => {
      claimCount += 1
      return claimCount === 1 ? claimed : []
    },
  )

  controller.add('local mirror', 'queue')
  assert.deepEqual(await controller.claimQueuedTurnMessages(), claimed)
  assert.deepEqual(controller.getQueuedTurnMessages(), [])
  assert.deepEqual(await controller.claimQueuedTurnMessages(), [])
})
