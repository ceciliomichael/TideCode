import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveReasoningEffortTransition } from '../../src/lib/reasoningEffortTransition'

test('GPT effort switches atomically to the Mistral binary default', () => {
  assert.equal(resolveReasoningEffortTransition({
    currentEffort: 'medium',
    defaultEffort: 'none',
    supportedEfforts: ['none', 'high'],
  }), 'none')
})

test('Mistral enabled state remains enabled when switching to a compatible GPT model', () => {
  assert.equal(resolveReasoningEffortTransition({
    currentEffort: 'high',
    defaultEffort: 'medium',
    supportedEfforts: ['low', 'medium', 'high'],
  }), 'high')
})

test('switching to a model without a reasoning control preserves the saved preference', () => {
  assert.equal(resolveReasoningEffortTransition({
    currentEffort: 'medium',
    supportedEfforts: [],
  }), 'medium')
})

test('an invalid declared default falls back to the supported model profile', () => {
  assert.equal(resolveReasoningEffortTransition({
    currentEffort: 'xhigh',
    defaultEffort: 'max',
    supportedEfforts: ['low', 'medium', 'high'],
  }), 'medium')
})
