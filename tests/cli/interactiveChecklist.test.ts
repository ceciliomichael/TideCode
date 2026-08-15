import test from 'node:test'
import assert from 'node:assert/strict'
import { buildChecklistViewItems } from '../../electron/cli/interactiveChecklist'

test('checklist view presents enabled and disabled values without changing labels', () => {
  const items = buildChecklistViewItems([
    { value: 'one', label: 'First', enabled: true },
    { value: 'two', label: 'Second', enabled: false, readOnly: true },
  ], new Set([0]))

  assert.equal(items[0]?.label, '[x] First')
  assert.equal(items[1]?.label, '[ ] Second')
  assert.equal(items[1]?.description, 'read-only')
})
