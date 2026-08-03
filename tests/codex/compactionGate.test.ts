import assert from 'node:assert/strict'
import test from 'node:test'
import type { CompactionResult } from '../../electron/chat/shared/compaction/contracts'
import { calculateContextBudget } from '../../electron/chat/shared/compaction/budget'
import {
  assertCompactionGate,
  ContextCompactionRequiredError,
} from '../../electron/chat/shared/compaction/gate'

function createBudget(messageTokens: number) {
  return calculateContextBudget({
    contextWindowTokens: 100_000,
    messageTokens,
    reserveTokens: 4_000,
    systemPromptTokens: 0,
    toolSchemaTokens: 0,
    triggerRatio: 0.8,
  })
}

const compactedResult = {} as CompactionResult

test('an over-threshold context cannot continue without a compaction result', () => {
  assert.throws(() => assertCompactionGate({
    aborted: false,
    compactionResult: null,
    projectedBudget: null,
    required: true,
  }), ContextCompactionRequiredError)
})

test('a completed compaction permits the next model step when the projection is below the trigger', () => {
  assert.doesNotThrow(() => assertCompactionGate({
    aborted: false,
    compactionResult: compactedResult,
    projectedBudget: createBudget(20_000),
    required: true,
  }))
})

test('a projection that remains over the compaction trigger is rejected', () => {
  assert.throws(() => assertCompactionGate({
    aborted: false,
    compactionResult: compactedResult,
    projectedBudget: createBudget(100_000),
    required: true,
  }), ContextCompactionRequiredError)
})

test('run cancellation is allowed to stop before the next model step', () => {
  assert.doesNotThrow(() => assertCompactionGate({
    aborted: true,
    compactionResult: null,
    projectedBudget: null,
    required: true,
  }))
})

test('below-threshold context does not require compaction', () => {
  assert.doesNotThrow(() => assertCompactionGate({
    aborted: false,
    compactionResult: null,
    projectedBudget: null,
    required: false,
  }))
})
