import assert from 'node:assert/strict'
import test from 'node:test'
import { getWorkspacePanelBounds } from '../src/lib/workspacePanelSizing'

test('right panel growth reserves the usable chat width', () => {
  assert.deepEqual(getWorkspacePanelBounds(1000, 512, 320, 760), { minWidth: 320, maxWidth: 488 })
})

test('an open editor and fixed chat both count against the right panel budget', () => {
  assert.deepEqual(getWorkspacePanelBounds(1200, 672 + 200, 360, 760), { minWidth: 328, maxWidth: 328 })
})

test('a narrow workspace never creates negative or inverted resize bounds', () => {
  assert.deepEqual(getWorkspacePanelBounds(480, 512, 320, 760), { minWidth: 0, maxWidth: 0 })
})

test('a wide workspace retains the configured panel maximum', () => {
  assert.deepEqual(getWorkspacePanelBounds(2000, 512, 320, 760), { minWidth: 320, maxWidth: 760 })
})
