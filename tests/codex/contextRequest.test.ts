import assert from 'node:assert/strict'
import test from 'node:test'
import { ContextUsageCorrection, prepareContextRequest } from '../../electron/chat/shared/contextRequest'
import { MODEL_IMAGE_TOKEN_ALLOWANCE, estimateModelMessageContextUsage } from '../../src/lib/contextUsage'
import { temporaryImageScenario } from '../fixtures/contextCompactionScenarios'
import type { ModelMessage } from 'ai'

test('temporary images count once for the next request without entering durable replay', () => {
  const request = prepareContextRequest({
    messages: [{ role: 'user', content: 'Inspect this screenshot.' }, temporaryImageScenario()],
    capabilities: { contextWindowTokens: 256_000, maxOutputTokens: 20_000, countingMethod: 'heuristic' },
    systemPromptTokens: 100, toolSchemaTokens: 200, triggerRatio: 0.8,
  })
  assert.equal(request.state.usage.imageTokens, MODEL_IMAGE_TOKEN_ALLOWANCE)
  assert.equal(request.visualMessages.length, 1)
  assert.equal(request.durableMessages.length, 1)
  assert.ok(request.state.budget.totalTokens < 5_000)
})

test('opaque reasoning metadata does not inflate context or leak into accounting identity', () => {
  const messages = (size: number): ModelMessage[] => [{ role: 'assistant', content: [{ type: 'reasoning', text: 'Visible rationale', providerOptions: { openai: { encryptedContent: 'A'.repeat(size) } } }] }]
  assert.equal(estimateModelMessageContextUsage(messages(1_000_000)).totalTokens, estimateModelMessageContextUsage(messages(1)).totalTokens)
})

test('the same image object supplied twice is charged for both occurrences', () => {
  const image = { type: 'image' as const, image: 'data:image/png;base64,AA==' }
  const usage = estimateModelMessageContextUsage([{ role: 'user', content: [image, image] }])
  assert.equal(usage.imageTokens, MODEL_IMAGE_TOKEN_ALLOWANCE * 2)
})

test('positive usage correction resets when the exact message prefix is rewritten', () => {
  const correction = new ContextUsageCorrection()
  const first: ModelMessage = { role: 'user', content: 'First' }
  assert.equal(correction.prepare([first]), 0)
  correction.observe(100, 150)
  assert.equal(correction.prepare([first, { role: 'assistant', content: 'Next' }]), 50)
  assert.equal(correction.prepare([{ role: 'user', content: 'Rewritten' }]), 0)
})
