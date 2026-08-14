import assert from 'node:assert/strict'
import test from 'node:test'
import {
  capRetainedContextTokens,
  CONTEXT_COMPACTION_LIMITS,
  DEFAULT_CONTEXT_COMPACTION_SETTINGS,
  MAX_CONTEXT_COMPACTION_RETAINED_TOKENS,
  mergeContextCompactionSettings,
  normalizeContextCompactionSettings,
} from '../src/lib/contextCompactionSettings'

test('context compaction settings use a fixed ten-thousand-token internal default', () => {
  assert.equal(DEFAULT_CONTEXT_COMPACTION_SETTINGS.retainedContextTokens, 10_000)
  assert.deepEqual(normalizeContextCompactionSettings({}), DEFAULT_CONTEXT_COMPACTION_SETTINGS)
})

test('context compaction settings clamp legacy retention tokens to the hard cap', () => {
  assert.equal(
    normalizeContextCompactionSettings({ retainedContextTokens: 0 }).retainedContextTokens,
    CONTEXT_COMPACTION_LIMITS.retainedContextTokens.minimum,
  )
  assert.equal(
    normalizeContextCompactionSettings({ retainedContextTokens: 999_999 }).retainedContextTokens,
    CONTEXT_COMPACTION_LIMITS.retainedContextTokens.maximum,
  )
  assert.equal(normalizeContextCompactionSettings({ retainedContextTokens: 2_600.4 }).retainedContextTokens, 4_000)
  assert.equal(normalizeContextCompactionSettings({ retainedContextTokens: Number.NaN }).retainedContextTokens, 10_000)
  assert.equal(normalizeContextCompactionSettings({ retainedTurnCount: 4 }).retainedContextTokens, 10_000)
})

test('retention targets stay within the hard cap', () => {
  assert.equal(MAX_CONTEXT_COMPACTION_RETAINED_TOKENS, 20_000)
  assert.equal(capRetainedContextTokens(999_999), MAX_CONTEXT_COMPACTION_RETAINED_TOKENS)
  assert.equal(capRetainedContextTokens(Number.NaN), 10_000)
  assert.equal(capRetainedContextTokens(2_600.4), 2_600)
})

test('merging a retention token update preserves and normalizes the other context settings', () => {
  const current = {
    contextWindowTokens: 128_000,
    retainedContextTokens: 10_000,
    triggerPercent: 80,
  }

  assert.deepEqual(
    mergeContextCompactionSettings(current, { retainedContextTokens: 25_000 }),
    {
      contextWindowTokens: 128_000,
      retainedContextTokens: 20_000,
      triggerPercent: 80,
    },
  )
})
