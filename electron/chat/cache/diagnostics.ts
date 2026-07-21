import type { CanonicalUsageSummary, NormalizedUsageRecord } from '../history/contracts'

export type CacheStepClassification = 'hit' | 'miss' | 'unreported' | 'write'

export function classifyCacheStep(usage: NormalizedUsageRecord): CacheStepClassification {
  if (usage.cacheReadTokens > 0) return 'hit'
  if (usage.cacheWriteTokens > 0) return 'write'
  if (usage.inputTokens > 0 || usage.noCacheTokens > 0) return 'miss'
  return 'unreported'
}

export function calculateCacheEfficiency(usage: CanonicalUsageSummary) {
  const measuredInputTokens = usage.cacheReadTokens + usage.noCacheTokens
  return {
    averageStepDurationMs: usage.stepCount > 0 ? usage.totalDurationMs / usage.stepCount : 0,
    cachedInputRatio: measuredInputTokens > 0 ? usage.cacheReadTokens / measuredInputTokens : 0,
    requestHitRate: usage.stepCount > 0 ? usage.cacheHitSteps / usage.stepCount : 0,
  }
}
