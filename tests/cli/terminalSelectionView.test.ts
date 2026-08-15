import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSelectionLines } from '../../electron/cli/terminalSelectionView'
import { visibleWidth } from '../../electron/cli/terminalText'

test('selection renderer keeps every border and content row aligned', () => {
  const lines = buildSelectionLines({
    title: 'Resume Previous Conversation',
    pageSize: 3,
    items: [
      { value: 'one', label: 'Make it so that we are able', description: 'Updated: 8/12/2026, 2:41:12 PM', badge: '[project: tidecode]' },
      { value: 'two', label: 'Hi', description: 'Updated: 8/5/2026, 7:56:00 PM', badge: '[project: workspace]' },
      { value: 'three', label: 'A third session', description: 'Updated: 8/9/2026, 11:50:16 PM' },
      { value: 'four', label: 'A fourth session', description: 'Updated: 8/9/2026, 11:50:16 PM' },
    ],
    footer: 'Esc to cancel',
  }, 0, 96)

  assert.ok(lines.length > 5)
  assert.ok(lines.every((line) => visibleWidth(line) === 96))
})

test('selection renderer shows separate active and archived pages including an empty page', () => {
  const lines = buildSelectionLines({
    title: 'Resume Conversation',
    pageSize: 10,
    items: [],
    emptyMessage: 'No archived conversations.',
    sectionNavigation: {
      labels: ['Active (12)', 'Archived (0)'],
      selectedIndex: 1,
    },
  }, 0, 84)

  assert.ok(lines.every((line) => visibleWidth(line) === 84))
  assert.ok(lines.some((line) => line.includes('Active (12)')))
  assert.ok(lines.some((line) => line.includes('[ Archived (0) ]')))
  assert.ok(lines.some((line) => line.includes('No archived conversations.')))
  assert.ok(lines.some((line) => line.includes('Left/Right')))
})
