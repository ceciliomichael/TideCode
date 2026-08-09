import assert from 'node:assert/strict'
import test from 'node:test'
import { stopAndRollbackPendingTurn } from '../src/hooks/chatPendingTurnWorkflow'

test('pre-token stop restores the local draft before aborting and rolling back', async () => {
  const events: string[] = []

  await stopAndRollbackPendingTurn({
    prepareLocalRollback: () => {
      events.push('restore-draft-and-remove-bubble')
    },
    abortActiveRun: async () => {
      events.push('stop')
    },
    rollbackPersistedTurn: async () => {
      events.push('rollback')
    },
  })

  assert.deepEqual(events, ['restore-draft-and-remove-bubble', 'stop', 'rollback'])
})

test('pre-token stop still rolls back the bubble when stream cancellation fails', async () => {
  const events: string[] = []
  const abortError = new Error('cancel failed')

  await assert.rejects(
    stopAndRollbackPendingTurn({
      prepareLocalRollback: () => {
        events.push('restore-draft-and-remove-bubble')
      },
      abortActiveRun: async () => {
        events.push('stop')
        throw abortError
      },
      rollbackPersistedTurn: async () => {
        events.push('rollback')
      },
    }),
    abortError,
  )

  assert.deepEqual(events, ['restore-draft-and-remove-bubble', 'stop', 'rollback'])
})
