import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveContextCapabilities } from '../../electron/chat/shared/contextCapabilities'
import { calculateContextBudget, requiresContextCompaction } from '../../electron/chat/shared/compaction/budget'
import type { ChatProviderId } from '../../src/types/chat'
import { budgetCompactionStream } from '../../electron/chat/shared/compaction/modelSelection'

test('unknown models on every transport use configured capacity independently of output maximum', () => {
  const providers: ChatProviderId[] = ['codex', 'openai', 'anthropic', 'google', 'mistral', 'deepseek', 'custom:unknown']
  for (const providerId of providers) {
    const capabilities = resolveContextCapabilities({ providerId, modelId: 'unknown', contextWindowTokens: 256_000, maximumOutputTokens: 1_000 })
    assert.equal(capabilities.contextWindowTokens, 256_000)
    assert.equal(capabilities.maxOutputTokens, 1_000)
  }
})

test('admission reserves output and uncertainty independently of a high preferred trigger', () => {
  const budget = calculateContextBudget({ contextWindowTokens: 16_000, messageTokens: 11_000, systemPromptTokens: 0, toolSchemaTokens: 0, triggerRatio: 0.95 })
  assert.equal(budget.admissionTokens, 10_976)
  assert.equal(requiresContextCompaction(budget), true)
  assert.ok(budget.totalTokens < budget.triggerTokens)
  assert.throws(() => calculateContextBudget({ contextWindowTokens: 100, messageTokens: 0, systemPromptTokens: 0, toolSchemaTokens: 0 }))
})

test('a worker request is checked against its own configured capacity before transport', async () => {
  let calls = 0
  const stream = budgetCompactionStream(async () => {
    calls += 1
    return { fullStream: (async function* () { yield { type: 'text-delta', text: 'Summary' } })() }
  }, 'custom:worker', 16_000)
  await assert.rejects(stream({
    messages: [{ role: 'user', content: 'Evidence '.repeat(10_000) }],
    model: 'unknown', system: 'Summarize.', reasoningEffort: 'low', signal: new AbortController().signal,
  }), { reason: 'summarizer_context_too_large' })
  assert.equal(calls, 0)
})
