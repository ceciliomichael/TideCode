import assert from 'node:assert/strict'
import test from 'node:test'
import { listCodexModels } from '../../../electron/models/providers/codex/models'

test('listCodexModels returns the codex model catalog from codex_models.json', () => {
  const models = listCodexModels()

  assert.ok(models.length > 0)
  assert.deepEqual(
    models.map((model) => model.providerId),
    Array.from({ length: models.length }, () => 'codex'),
  )
  assert.equal(models.find((model) => model.id === 'gpt-5.6-sol')?.enabledByDefault, true)
  assert.equal(models.find((model) => model.id === 'gpt-5.4-mini')?.reasoningCapable, true)
})
