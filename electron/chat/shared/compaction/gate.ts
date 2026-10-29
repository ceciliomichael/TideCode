import type { ContextBudget } from './budget'
import type { CompactionReason } from './contracts'
import { errorCatalog } from '../../../../src/lib/errors/errorCatalog'

export class CompactionError extends Error {
  readonly code: string
  constructor(readonly reason: CompactionReason, options?: ErrorOptions) {
    super(errorCatalog[`compaction.${reason}`].message, options)
    this.name = 'CompactionError'
    this.code = `compaction.${reason}`
  }
}

export function assertContextAdmission(budget: ContextBudget) {
  if (budget.totalTokens + budget.correctionTokens > budget.admissionTokens) {
    throw new CompactionError('projection_too_large')
  }
}
