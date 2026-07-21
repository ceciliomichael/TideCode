import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveModelReasoningProfile } from '../../src/lib/modelReasoningProfiles'

test('declared model reasoning levels and default are used exactly', () => {
  assert.deepEqual(resolveModelReasoningProfile({
    defaultReasoningEffort: 'high',
    reasoningCapable: true,
    reasoningEfforts: ['none', 'high'],
  }), {
    defaultEffort: 'high',
    efforts: ['none', 'high'],
  })
})

test('models without declared reasoning levels do not show a selector', () => {
  assert.equal(resolveModelReasoningProfile({ reasoningCapable: false }), null)
  assert.equal(resolveModelReasoningProfile({ reasoningCapable: true }), null)
})

test('medium is the fallback default when it is available', () => {
  assert.deepEqual(resolveModelReasoningProfile({
    reasoningCapable: true,
    reasoningEfforts: ['low', 'medium', 'high'],
  })?.defaultEffort, 'medium')
})
