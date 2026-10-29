import assert from 'node:assert/strict'
import test from 'node:test'
import type { LanguageModelUsage } from 'ai'
import { normalizeLanguageModelUsage } from '../../electron/chat/cache/usage'
import { classifyCacheStep } from '../../electron/chat/cache/diagnostics'

test('unreported cache usage differs from an explicit zero cache hit', () => {
  const usage = (cacheReadTokens?: number) => normalizeLanguageModelUsage({ inputTokens: 1_000, inputTokenDetails: { cacheReadTokens } } as LanguageModelUsage)
  assert.equal(classifyCacheStep(usage()), 'unreported')
  assert.equal(classifyCacheStep(usage(0)), 'miss')
  assert.equal(classifyCacheStep(usage(500)), 'hit')
})

test('SDK total input is never increased by raw cached token fields', () => {
  const usage = normalizeLanguageModelUsage({ inputTokens: 1_000, raw: { cache_read_input_tokens: 800, cache_creation_input_tokens: 100 } } as LanguageModelUsage)
  assert.equal(usage.inputTokens, 1_000)
  assert.equal(usage.cacheReadTokens, 800)
  assert.equal(usage.cacheWriteTokens, 100)
  assert.equal(usage.noCacheTokens, 100)
})
