import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateContextBudget } from '../../electron/chat/shared/compaction/budget'
import { assertContextAdmission } from '../../electron/chat/shared/compaction/gate'

function budget(messageTokens: number) {
  return calculateContextBudget({ contextWindowTokens: 256_000, messageTokens, systemPromptTokens: 0, toolSchemaTokens: 0 })
}

test('a request over the preferred trigger is admitted while response and uncertainty reserves fit', () => {
  assert.doesNotThrow(() => assertContextAdmission(budget(210_000)))
})

test('a request under the full context window is rejected if response space cannot fit', () => {
  assert.throws(() => assertContextAdmission(budget(224_000)), { reason: 'projection_too_large' })
})

test('admission accepts the exact ceiling and includes positive provider undercount correction', () => {
  const exact = budget(223_200)
  assert.doesNotThrow(() => assertContextAdmission(exact))
  assert.throws(() => assertContextAdmission({ ...exact, correctionTokens: 1 }), { reason: 'projection_too_large' })
})
