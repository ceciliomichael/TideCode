import type { CanonicalHistoryEvent } from './contracts'

export function shouldPreserveNewerCompactionReplay(input: {
  activeBranchId: string
  compactionId?: string | null
  events: readonly CanonicalHistoryEvent[]
  runId: string
}) {
  const runStartedEvent = [...input.events].reverse().find((event) => (
    event.type === 'run_started' && event.runId === input.runId
  ))
  const runStartedRevision = runStartedEvent?.revision ?? -1
  const compactionsAfterRunStarted = input.events.filter((event) => (
    event.branchId === input.activeBranchId &&
    event.type === 'compaction_committed' &&
    event.revision > runStartedRevision
  ))
  const latestCompaction = compactionsAfterRunStarted.at(-1)
  if (!latestCompaction || latestCompaction.type !== 'compaction_committed') return false
  if (!('compactionId' in latestCompaction)) return false

  return latestCompaction.compactionId !== input.compactionId
}
