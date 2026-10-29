import type { LanguageModelUsage } from 'ai'
import type { NormalizedUsageRecord } from '../history/contracts'

function count(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function rawCount(raw: unknown, ...paths: string[][]): number | undefined {
  for (const path of paths) {
    let value: unknown = raw
    for (const key of path) value = record(value)?.[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  }
  return undefined
}

export function normalizeLanguageModelUsage(usage: LanguageModelUsage): NormalizedUsageRecord {
  const cacheReadTokens = rawCount(
    usage.raw,
    ['prompt_cache_hit_tokens'],
    ['cache_read_input_tokens'],
    ['cachedContentTokenCount'],
    ['total_cached_tokens'],
    ['num_cached_tokens'],
    ['prompt_tokens_details', 'cached_tokens'],
    ['prompt_token_details', 'cached_tokens'],
    ['input_tokens_details', 'cached_tokens'],
  ) ?? usage.inputTokenDetails?.cacheReadTokens
  const cacheWriteTokens = rawCount(
    usage.raw,
    ['cache_creation_input_tokens'],
    ['prompt_cache_write_tokens'],
  ) ?? usage.inputTokenDetails?.cacheWriteTokens
  const rawNoCacheTokens = rawCount(
    usage.raw,
    ['prompt_cache_miss_tokens'],
  )
  const reportedNoCacheTokens = rawNoCacheTokens ?? usage.inputTokenDetails?.noCacheTokens
  const inputTokens = count(usage.inputTokens)
  const noCacheTokens = count(reportedNoCacheTokens ?? Math.max(0, inputTokens - count(cacheReadTokens) - count(cacheWriteTokens)))
  return {
    reporting: {
      input: typeof usage.inputTokens === 'number' && Number.isFinite(usage.inputTokens) && usage.inputTokens >= 0 ? 'reported' : 'unknown',
      cacheRead: typeof cacheReadTokens === 'number' && Number.isFinite(cacheReadTokens) && cacheReadTokens >= 0 && cacheReadTokens <= inputTokens ? 'reported' : 'unknown',
      cacheWrite: typeof cacheWriteTokens === 'number' && Number.isFinite(cacheWriteTokens) && cacheWriteTokens >= 0 && cacheWriteTokens <= inputTokens ? 'reported' : 'unknown',
      noCache: reportedNoCacheTokens !== undefined && reportedNoCacheTokens >= 0 && reportedNoCacheTokens <= inputTokens ? 'reported' : usage.inputTokens !== undefined ? 'derived' : 'unknown',
    },
    cacheReadTokens: count(cacheReadTokens),
    cacheWriteTokens: count(cacheWriteTokens),
    inputTokens,
    noCacheTokens,
    outputTokens: count(usage.outputTokens),
    reasoningTokens: count(usage.outputTokenDetails?.reasoningTokens),
    totalTokens: count(usage.totalTokens),
  }
}
