import assert from 'node:assert/strict'
import test from 'node:test'
import { buildKanbanBoardDisplayData } from '../../src/components/kanban/kanbanHierarchy'
import { clearDoneKanbanCards, parseKanbanBoardData } from '../../src/lib/kanban'

test('Kanban board renders only main tasks and surfaces a parent when its subtask matches search', () => {
  const boardData = parseKanbanBoardData({
    cards: [
      { columnId: 'backlog', createdAt: 1, description: '', id: 'parent', priority: 'high', title: 'Parent task', updatedAt: 1 },
      { columnId: 'in-progress', createdAt: 2, description: '', id: 'child', parentCardId: 'parent', priority: 'low', title: 'Needle subtask', updatedAt: 2 },
      { columnId: 'in-progress', createdAt: 3, description: '', id: 'standalone', priority: 'low', title: 'Standalone task', updatedAt: 3 },
    ],
  })

  const defaultDisplay = buildKanbanBoardDisplayData(boardData.cards)
  assert.deepEqual(defaultDisplay.orderedCardsByColumn.backlog.map((card) => card.id), ['parent'])
  assert.deepEqual(defaultDisplay.orderedCardsByColumn['in-progress'].map((card) => card.id), ['standalone'])
  assert.equal(defaultDisplay.cardMetaById.get('parent')?.childCount, 1)

  const searchDisplay = buildKanbanBoardDisplayData(boardData.cards, {
    priority: 'all',
    query: 'needle',
  })
  assert.deepEqual(searchDisplay.orderedCardsByColumn.backlog.map((card) => card.id), ['parent'])
  assert.equal(searchDisplay.orderedCardsByColumn['in-progress'].length, 0)

  const parentPriorityFilter = buildKanbanBoardDisplayData(boardData.cards, {
    priority: 'low',
    query: 'needle',
  })
  assert.equal(parentPriorityFilter.orderedCardsByColumn.backlog.length, 0)
})

test('Clear done removes approved main tasks with their subtasks but preserves review subtasks', () => {
  const boardData = parseKanbanBoardData({
    cards: [
      { columnId: 'done', createdAt: 1, description: '', id: 'approved-parent', title: 'Approved', updatedAt: 1 },
      { columnId: 'done', createdAt: 2, description: '', id: 'approved-child', parentCardId: 'approved-parent', title: 'Approved child', updatedAt: 2 },
      { columnId: 'for-review', createdAt: 3, description: '', id: 'review-parent', title: 'Review', updatedAt: 3 },
      { columnId: 'done', createdAt: 4, description: '', id: 'review-child', parentCardId: 'review-parent', title: 'Review child', updatedAt: 4 },
    ],
  })

  const cleared = clearDoneKanbanCards(boardData)
  assert.deepEqual(cleared.cards.map((card) => card.id).sort(), ['review-child', 'review-parent'])
  assert.equal(cleared.cards.find((card) => card.id === 'review-child')?.parentCardId, 'review-parent')
})
