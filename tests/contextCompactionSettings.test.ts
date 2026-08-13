import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONTEXT_COMPACTION_LIMITS,
  DEFAULT_CONTEXT_COMPACTION_SETTINGS,
  mergeContextCompactionSettings,
  normalizeContextCompactionSettings,
} from '../src/lib/contextCompactionSettings'

test('context compaction settings retain the current four-turn default', () => {
  assert.equal(DEFAULT_CONTEXT_COMPACTION_SETTINGS.retainedTurnCount, 4)
  assert.deepEqual(normalizeContextCompactionSettings({}), DEFAULT_CONTEXT_COMPACTION_SETTINGS)
})

test('context compaction settings clamp invalid retention counts to the supported range', () => {
  assert.equal(
    normalizeContextCompactionSettings({ retainedTurnCount: 0 }).retainedTurnCount,
    CONTEXT_COMPACTION_LIMITS.retainedTurnCount.minimum,
  )
  assert.equal(
    normalizeContextCompactionSettings({ retainedTurnCount: 99 }).retainedTurnCount,
    CONTEXT_COMPACTION_LIMITS.retainedTurnCount.maximum,
  )
  assert.equal(normalizeContextCompactionSettings({ retainedTurnCount: 2.6 }).retainedTurnCount, 3)
  assert.equal(normalizeContextCompactionSettings({ retainedTurnCount: Number.NaN }).retainedTurnCount, 4)
})

test('merging a retention update preserves and normalizes the other context settings', () => {
  const current = {
    contextWindowTokens: 128_000,
    retainedTurnCount: 4,
    triggerPercent: 80,
  }

  assert.deepEqual(
    mergeContextCompactionSettings(current, { retainedTurnCount: 8 }),
    {
      contextWindowTokens: 128_000,
      retainedTurnCount: 8,
      triggerPercent: 80,
    },
  )
})
