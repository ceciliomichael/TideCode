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
  const solModel = models.find((model) => model.id === 'gpt-6-sol')
  const lunaModel = models.find((model) => model.id === 'gpt-6-luna')
  assert.equal(solModel?.enabledByDefault, true)
  assert.deepEqual(solModel?.reasoningEfforts, ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(lunaModel?.reasoningEfforts, ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(
    models.find((model) => model.id === 'gpt-5.6-sol')?.reasoningEfforts,
    ['low', 'medium', 'high', 'xhigh', 'max'],
  )
  assert.deepEqual(
    models.find((model) => model.id === 'gpt-5.6-luna')?.reasoningEfforts,
    ['low', 'medium', 'high', 'xhigh', 'max'],
  )
  assert.equal(models.find((model) => model.id === 'gpt-5.5')?.reasoningCapable, true)
})
