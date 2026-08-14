import assert from 'node:assert/strict'
import test from 'node:test'
import type { CanonicalHistoryEvent } from '../../electron/chat/history/contracts'
import { shouldPreserveNewerCompactionReplay } from '../../electron/chat/history/replayWritePolicy'

function event(overrides: Partial<CanonicalHistoryEvent>): CanonicalHistoryEvent {
  return {
    branchId: 'main',
    createdAt: 1,
    eventId: 'event',
    runId: null,
    type: 'run_completed',
    ...overrides,
  } as CanonicalHistoryEvent
}

test('a run completion cannot replace a newer compaction with stale replay', () => {
  const events = [
    event({ eventId: 'run-start', revision: 1, runId: 'run-1', type: 'run_started' }),
    event({
      compactionId: 'compaction-2',
      eventId: 'compaction',
      revision: 2,
      type: 'compaction_committed',
    }),
  ]

  assert.equal(shouldPreserveNewerCompactionReplay({
    activeBranchId: 'main',
    compactionId: null,
    events,
    runId: 'run-1',
  }), true)
})

test('the run that created the latest compaction may persist its final replay', () => {
  const events = [
    event({ eventId: 'run-start', revision: 1, runId: 'run-1', type: 'run_started' }),
    event({
      compactionId: 'compaction-1',
      eventId: 'compaction',
      revision: 2,
      type: 'compaction_committed',
    }),
  ]

  assert.equal(shouldPreserveNewerCompactionReplay({
    activeBranchId: 'main',
    compactionId: 'compaction-1',
    events,
    runId: 'run-1',
  }), false)
})
