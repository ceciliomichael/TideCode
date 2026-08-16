import test from 'node:test'
import assert from 'node:assert/strict'
import type { Message } from '../../src/types/chat'
import {
  resolveCliUndoCheckpointPlan,
  runWithCliUndoWorkspaceReverted,
} from '../../electron/cli/cliUndoCheckpoints'

function checkpoint(id: string, createdAt: number) {
  return { id, createdAt }
}

test('CLI undo resolves the selected turn and every later turn checkpoint in order', async () => {
  const messages: Message[] = [
    {
      content: 'first task',
      id: 'user-1',
      role: 'user',
      runCheckpoint: checkpoint('checkpoint-1', 1),
      timestamp: 1,
      userMessageKind: 'human',
    },
    { content: 'first answer', id: 'assistant-1', role: 'assistant', timestamp: 2 },
    {
      content: 'steer this run',
      id: 'steer-1',
      role: 'user',
      timestamp: 3,
      userMessageKind: 'steer',
    },
    {
      content: 'second task',
      id: 'user-2',
      role: 'user',
      runCheckpoint: checkpoint('checkpoint-2', 4),
      timestamp: 4,
      userMessageKind: 'human',
    },
  ]

  const plan = await resolveCliUndoCheckpointPlan('conversation-1', messages, 'user-1', {
    getCheckpointHistory: async () => {
      throw new Error('checkpoint history should not be needed')
    },
  })

  assert.equal(plan.targetUserIndex, 0)
  assert.equal(plan.targetUserMessageId, 'user-1')
  assert.deepEqual(plan.checkpointIds, ['checkpoint-1', 'checkpoint-2'])
})

test('CLI undo treats a same-turn steer as part of its parent checkpointed turn', async () => {
  const messages: Message[] = [
    {
      content: 'parent task',
      id: 'user-parent',
      role: 'user',
      runCheckpoint: checkpoint('checkpoint-parent', 1),
      timestamp: 1,
      userMessageKind: 'human',
    },
    {
      content: 'same turn steer',
      id: 'user-steer',
      role: 'user',
      timestamp: 2,
      userMessageKind: 'steer',
    },
  ]

  const plan = await resolveCliUndoCheckpointPlan('conversation-1', messages, 'user-steer', {
    getCheckpointHistory: async () => [],
  })

  assert.equal(plan.targetUserIndex, 0)
  assert.equal(plan.targetUserMessageId, 'user-parent')
  assert.deepEqual(plan.checkpointIds, ['checkpoint-parent'])
})

test('CLI undo falls back to persisted checkpoint history for a rewritten user message', async () => {
  const messages: Message[] = [
    {
      content: 'edited task',
      id: 'user-edited',
      role: 'user',
      timestamp: 1,
      userMessageKind: 'human',
    },
  ]
  const historyRequests: Array<[string, string]> = []

  const plan = await resolveCliUndoCheckpointPlan('conversation-history', messages, 'user-edited', {
    getCheckpointHistory: async (conversationId, messageId) => {
      historyRequests.push([conversationId, messageId])
      return [
        checkpoint('checkpoint-old', 1),
        checkpoint('checkpoint-newest', 2),
      ]
    },
  })

  assert.deepEqual(historyRequests, [['conversation-history', 'user-edited']])
  assert.deepEqual(plan.checkpointIds, ['checkpoint-newest'])
})

test('CLI undo restores checkpoints before rewriting history', async () => {
  const calls: string[] = []
  const result = await runWithCliUndoWorkspaceReverted(
    {
      checkpointIds: ['checkpoint-1', 'checkpoint-2'],
      targetUserIndex: 0,
      targetUserMessageId: 'user-1',
    },
    async () => {
      calls.push('rewrite-history')
      return 'rewritten'
    },
    {
      createRedoCheckpoint: async (checkpointIds) => {
        calls.push(`create-redo:${checkpointIds.join(',')}`)
        return checkpoint('redo-1', 3)
      },
      restoreCheckpointSequence: async (checkpointIds) => {
        calls.push(`restore-sequence:${checkpointIds.join(',')}`)
      },
      restoreCheckpoint: async (checkpointId) => {
        calls.push(`restore-redo:${checkpointId}`)
      },
    },
  )

  assert.equal(result, 'rewritten')
  assert.deepEqual(calls, [
    'create-redo:checkpoint-1,checkpoint-2',
    'restore-sequence:checkpoint-1,checkpoint-2',
    'rewrite-history',
  ])
})

test('CLI undo restores the pre-undo workspace snapshot when history rewrite fails', async () => {
  const calls: string[] = []
  await assert.rejects(
    runWithCliUndoWorkspaceReverted(
      {
        checkpointIds: ['checkpoint-1'],
        targetUserIndex: 0,
        targetUserMessageId: 'user-1',
      },
      async () => {
        calls.push('rewrite-history')
        throw new Error('replace failed')
      },
      {
        createRedoCheckpoint: async () => {
          calls.push('create-redo')
          return checkpoint('redo-1', 2)
        },
        restoreCheckpointSequence: async () => {
          calls.push('restore-sequence')
        },
        restoreCheckpoint: async (checkpointId) => {
          calls.push(`restore-redo:${checkpointId}`)
        },
      },
    ),
    /replace failed/,
  )

  assert.deepEqual(calls, [
    'create-redo',
    'restore-sequence',
    'rewrite-history',
    'restore-redo:redo-1',
  ])
})
