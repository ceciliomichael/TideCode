import type { ModelMessage } from 'ai'

/**
 * Chooses the same model-message projection that the runtime sends to the
 * provider. The display transcript can contain stale, aborted, or
 * provider-invalid tool entries that are intentionally removed by canonical
 * replay. Counting those entries would make the indicator claim that the
 * model is over its threshold when the model never received them.
 */
export function selectContextUsageMessages(input: {
  canonicalMessages: readonly ModelMessage[]
  fallbackMessages: readonly ModelMessage[]
  isCompacted: boolean
}): ModelMessage[] {
  if (input.isCompacted || input.canonicalMessages.length > 0) {
    return [...input.canonicalMessages]
  }

  return [...input.fallbackMessages]
}
