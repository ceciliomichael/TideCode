import assert from 'node:assert/strict'
import test from 'node:test'
import { orderReasoningEfforts } from '../src/lib/reasoningEffortOrder'

test('orders reasoning efforts from maximum to none', () => {
  assert.deepEqual(
    orderReasoningEfforts(['none', 'low', 'medium', 'high', 'xhigh', 'max', 'minimal']),
    ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none'],
  )
})

test('keeps unknown reasoning efforts after supported values in their original order', () => {
  assert.deepEqual(
    orderReasoningEfforts(['custom-high', 'none', 'custom-low', 'high']),
    ['high', 'none', 'custom-high', 'custom-low'],
  )
})
