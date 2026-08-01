import assert from 'node:assert/strict'
import test from 'node:test'
import { listCatalogModels } from '../../../electron/models/catalog/catalog'

test('Mistral models come from the editable catalog with binary reasoning choices', () => {
  const models = listCatalogModels('mistral')
  assert.deepEqual(models.map((model) => model.apiModelId), [
    'mistral-large-latest',
    'mistral-medium-latest',
    'mistral-small-latest',
  ])
  assert.ok(models.every((model) => model.providerId === 'mistral'))
  assert.ok(models.every((model) => model.reasoningEfforts?.join(',') === 'none,high'))
})
