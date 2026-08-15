import assert from 'node:assert/strict'
import test from 'node:test'
import { cycleSelectionSectionIndex } from '../../electron/cli/selectionNavigation'

test('resume section navigation wraps in both directions', () => {
  assert.equal(cycleSelectionSectionIndex(0, 1, 2), 1)
  assert.equal(cycleSelectionSectionIndex(1, 1, 2), 0)
  assert.equal(cycleSelectionSectionIndex(0, -1, 2), 1)
  assert.equal(cycleSelectionSectionIndex(1, -1, 2), 0)
})
