import assert from 'node:assert/strict'
import test from 'node:test'
import { KANBAN_COLUMNS } from '../../src/components/kanban/kanbanDefaults'
import {
  KANBAN_COLUMN_IDS,
  parseKanbanCard,
} from '../../src/lib/kanban'

test('uses For Review as the dependency column', () => {
  assert.deepEqual(KANBAN_COLUMN_IDS, [
    'backlog',
    'in-progress',
    'for-review',
    'done',
  ])

  assert.deepEqual(KANBAN_COLUMNS[2], {
    description:
      'Items awaiting review, clarification, access, or another dependency.',
    id: 'for-review',
    title: 'For Review',
  })
})

test('migrates persisted Blocked cards to For Review', () => {
  const card = parseKanbanCard({
    acceptanceCriteria: [],
    columnId: 'blocked',
    createdAt: 1,
    description: '',
    id: 'legacy-card',
    issueType: 'task',
    labels: [],
    position: 1,
    priority: 'none',
    revision: 0,
    title: 'Legacy card',
    updatedAt: 1,
  })

  assert.equal(card?.columnId, 'for-review')
})
