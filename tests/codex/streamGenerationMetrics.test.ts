import assert from 'node:assert/strict'
import test from 'node:test'
import { StreamGenerationMetrics } from '../../electron/chat/shared/streamGenerationMetrics'

test('speed spans text, reasoning and arguments without counting tool waits or arguments twice', () => {
  let now = 0
  const metrics = new StreamGenerationMetrics(() => now)
  metrics.beginRequest()
  metrics.observe({ type: 'reasoning-delta', text: 'abcdefgh' })
  now = 1000
  metrics.observe({ type: 'text-delta', text: 'abcdefgh' })
  now = 2000
  metrics.observe({ type: 'tool-input-delta', id: 'a', delta: '{"x":12}' })
  metrics.observe({ type: 'tool-call', toolCallId: 'a', input: { x: 12 } })
  now = 12000
  metrics.observe({ type: 'tool-result', toolCallId: 'a' })
  assert.deepEqual(metrics.snapshot(), {
    estimated: true, outputTokens: 6, generationMs: 2000, toolExecutionMs: 10000,
  })
  metrics.observe({ type: 'finish-step', usage: { outputTokens: 40 } })
  metrics.observe({ type: 'finish', totalUsage: { outputTokens: 40 } })
  metrics.endRequest()
  assert.deepEqual(metrics.snapshot(), {
    estimated: false, outputTokens: 40, generationMs: 2000, toolExecutionMs: 10000,
  })
})

test('parallel tool execution uses wall time rather than adding overlapping durations', () => {
  let now = 0
  const metrics = new StreamGenerationMetrics(() => now)
  metrics.beginRequest()
  metrics.observe({ type: 'tool-call', toolCallId: 'a' })
  now = 1000
  metrics.observe({ type: 'tool-call', toolCallId: 'b' })
  now = 2000
  metrics.observe({ type: 'tool-result', toolCallId: 'a' })
  now = 5000
  metrics.observe({ type: 'tool-error', toolCallId: 'b' })
  assert.equal(metrics.snapshot().toolExecutionMs, 5000)
})

test('continuations retain totals and exclude idle time between requests', () => {
  let now = 0
  const metrics = new StreamGenerationMetrics(() => now)
  for (const start of [0, 10000]) {
    now = start
    metrics.beginRequest()
    metrics.observe({ type: 'text-delta', text: 'abcd' })
    now += 1000
    metrics.observe({ type: 'text-delta', text: 'efgh' })
    metrics.observe({ type: 'finish-step', usage: { outputTokens: 10 } })
    metrics.observe({ type: 'finish', totalUsage: { outputTokens: 10 } })
    metrics.endRequest()
  }
  assert.deepEqual(metrics.snapshot(), {
    estimated: false, outputTokens: 20, generationMs: 2000, toolExecutionMs: 0,
  })
})

test('missing or invalid usage stays estimated and partial cancellation retains output', () => {
  let now = 0
  const metrics = new StreamGenerationMetrics(() => now)
  metrics.beginRequest()
  metrics.observe({ type: 'text-delta', text: 'abcd' })
  now = 1000
  metrics.observe({ type: 'text-delta', text: 'efgh' })
  metrics.observe({ type: 'finish-step', usage: { outputTokens: NaN } })
  metrics.observe({ type: 'tool-input-delta', id: 'a', delta: '1234' })
  metrics.observe({ type: 'tool-call', toolCallId: 'a' })
  now = 4000
  metrics.endRequest()
  assert.deepEqual(metrics.snapshot(), {
    estimated: true, outputTokens: 3, generationMs: 1000, toolExecutionMs: 3000,
  })
})

test('a final usage total can replace estimates when step usage is unavailable', () => {
  const metrics = new StreamGenerationMetrics(() => 0)
  metrics.beginRequest()
  metrics.observe({ type: 'text-delta', text: 'abcdefgh' })
  metrics.observe({ type: 'finish', totalUsage: { outputTokens: 8 } })
  metrics.endRequest()
  assert.equal(metrics.snapshot().outputTokens, 8)
  assert.equal(metrics.snapshot().estimated, false)
  assert.equal(metrics.snapshot().generationMs, 0)
})
