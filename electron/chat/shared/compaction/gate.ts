import type { CompactionResult } from './contracts'
import type { ContextBudget } from './budget'
import { shouldCompactContext } from './budget'

export class ContextCompactionRequiredError extends Error {
  readonly code = 'context_compaction_required' as const

  constructor(message = 'Context compaction was required before continuing, but no safe compacted projection was available.') {
    super(message)
    this.name = 'ContextCompactionRequiredError'
  }
}

export function assertCompactionGate(input: {
  aborted: boolean
  compactionResult: CompactionResult | null
  projectedBudget: ContextBudget | null
  required: boolean
}) {
  if (input.aborted || !input.required) return
  if (!input.compactionResult || !input.projectedBudget || shouldCompactContext(input.projectedBudget)) {
    throw new ContextCompactionRequiredError()
  }
}
