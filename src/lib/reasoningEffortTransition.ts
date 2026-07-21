import { normalizeReasoningEffort } from './reasoningEffort'
import type { ReasoningEffort } from '../types/chat'

interface ResolveReasoningEffortTransitionInput {
  currentEffort: ReasoningEffort
  defaultEffort?: ReasoningEffort
  supportedEfforts?: readonly ReasoningEffort[]
}

/**
 * Resolves the reasoning value that can travel atomically with a model change.
 * Models without a declared reasoning control leave the user's saved preference
 * untouched so it remains available when they return to a reasoning model.
 */
export function resolveReasoningEffortTransition({
  currentEffort,
  defaultEffort,
  supportedEfforts,
}: ResolveReasoningEffortTransitionInput): ReasoningEffort {
  if (!supportedEfforts?.length || supportedEfforts.includes(currentEffort)) {
    return currentEffort
  }

  if (defaultEffort && supportedEfforts.includes(defaultEffort)) {
    return defaultEffort
  }

  return normalizeReasoningEffort(currentEffort, supportedEfforts)
}
