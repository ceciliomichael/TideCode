import type { ModelMessage } from 'ai'
import { estimateModelMessageContextUsage } from '../../../src/lib/contextUsage'

/**
 * Chooses the model-message projection used by the context indicator.
 *
 * Canonical replay is authoritative after compaction, because the raw
 * transcript intentionally remains larger than the model-facing projection.
 * Outside compaction, however, canonical history can briefly lag the live
 * transcript while a tool turn is being persisted. In that window the smaller
 * replay must not make the indicator appear to lose context, so the live
 * projection wins whenever it accounts for more model-visible content.
 */
export function selectContextUsageMessages(input: {
  canonicalMessages: readonly ModelMessage[]
  fallbackMessages: readonly ModelMessage[]
  isCompacted: boolean
}): ModelMessage[] {
  if (input.isCompacted) {
    return [...input.canonicalMessages]
  }

  const canonicalUsage = estimateModelMessageContextUsage(input.canonicalMessages)
  const fallbackUsage = estimateModelMessageContextUsage(input.fallbackMessages)
  return fallbackUsage.totalTokens > canonicalUsage.totalTokens
    ? [...input.fallbackMessages]
    : [...input.canonicalMessages]
}
