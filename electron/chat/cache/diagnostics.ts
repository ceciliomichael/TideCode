import type { CanonicalUsageSummary, NormalizedUsageRecord } from '../history/contracts'

export type CacheStepClassification = 'hit' | 'miss' | 'unreported' | 'write'

export function classifyCacheStep(usage: NormalizedUsageRecord): CacheStepClassification {
  if (usage.reporting?.cacheRead === 'unknown' && usage.reporting?.cacheWrite === 'unknown') return 'unreported'
  if (usage.cacheReadTokens > 0 && usage.reporting?.cacheRead !== 'unknown') return 'hit'
  if (usage.cacheWriteTokens > 0 && usage.reporting?.cacheWrite !== 'unknown') return 'write'
  if (usage.reporting?.cacheRead === 'reported') return 'miss'
  return 'unreported'
}

export function calculateCacheEfficiency(usage: CanonicalUsageSummary) {
  const measuredInputTokens = usage.reportedCacheInputTokens ?? 0
  const reportedSteps = usage.reportedCacheSteps ?? 0
  return {
    averageStepDurationMs: usage.stepCount > 0 ? usage.totalDurationMs / usage.stepCount : 0,
    cachedInputRatio: measuredInputTokens > 0 ? (usage.reportedCacheReadTokens ?? 0) / measuredInputTokens : null,
    requestHitRate: reportedSteps > 0 ? (usage.reportedCacheHitSteps ?? 0) / reportedSteps : null,
    reportingCoverage: usage.stepCount > 0 ? reportedSteps / usage.stepCount : 0,
  }
}
