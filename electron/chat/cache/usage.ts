import type { LanguageModelUsage } from 'ai'
import type { NormalizedUsageRecord } from '../history/contracts'

function count(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
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
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

export function normalizeLanguageModelUsage(usage: LanguageModelUsage): NormalizedUsageRecord {
  const cacheReadTokens = rawCount(
    usage.raw,
    ['prompt_cache_hit_tokens'],
    ['cache_read_input_tokens'],
    ['prompt_tokens_details', 'cached_tokens'],
    ['input_tokens_details', 'cached_tokens'],
  ) ?? count(usage.inputTokenDetails?.cacheReadTokens)
  const cacheWriteTokens = rawCount(
    usage.raw,
    ['cache_creation_input_tokens'],
    ['prompt_cache_write_tokens'],
  ) ?? count(usage.inputTokenDetails?.cacheWriteTokens)
  const rawNoCacheTokens = rawCount(
    usage.raw,
    ['prompt_cache_miss_tokens'],
  )
  const noCacheTokens = rawNoCacheTokens ?? count(usage.inputTokenDetails?.noCacheTokens)
  return {
    cacheReadTokens,
    cacheWriteTokens,
    inputTokens: count(usage.inputTokens),
    noCacheTokens: noCacheTokens || Math.max(0, count(usage.inputTokens) - cacheReadTokens),
    outputTokens: count(usage.outputTokens),
    reasoningTokens: count(usage.outputTokenDetails?.reasoningTokens),
    totalTokens: count(usage.totalTokens),
  }
}
