import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONTEXT_COMPACTION_LIMITS,
  CONTEXT_COMPACTION_RETAINED_TOKEN_OPTIONS,
  DEFAULT_CONTEXT_COMPACTION_SETTINGS,
  mergeContextCompactionSettings,
  normalizeContextCompactionSettings,
} from '../src/lib/contextCompactionSettings'

test('context compaction settings use a configurable ten-thousand-token default', () => {
  assert.equal(DEFAULT_CONTEXT_COMPACTION_SETTINGS.retainedContextTokens, 10_000)
  assert.deepEqual(normalizeContextCompactionSettings({}), DEFAULT_CONTEXT_COMPACTION_SETTINGS)
})

test('context compaction settings clamp invalid retention tokens to the supported range', () => {
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

test('retention token presets stay within the normalized supported range', () => {
  assert.deepEqual(
    [...CONTEXT_COMPACTION_RETAINED_TOKEN_OPTIONS],
    [4_000, 8_000, 10_000, 12_000, 16_000, 20_000],
  )
  for (const value of CONTEXT_COMPACTION_RETAINED_TOKEN_OPTIONS) {
    assert.equal(normalizeContextCompactionSettings({ retainedContextTokens: value }).retainedContextTokens, value)
  }
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
