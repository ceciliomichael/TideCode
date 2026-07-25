import assert from 'node:assert/strict'
import test from 'node:test'
import { presentKanbanError } from '../../src/components/kanban/kanbanErrorPresentation'

test('turns the incomplete-subtask rule into actionable product copy', () => {
  const error = presentKanbanError(
    'reorder',
    new Error(
      "Error invoking remote method 'kanban:reorderCard': Error: A parent task cannot be moved to done until all subtasks are done.",
    ),
    'task-123',
  )

  assert.deepEqual(error, {
    description:
      'This task can move to Done after every subtask is marked Done.',
    guidance:
      'Review the task and finish or move each remaining subtask to Done.',
    relatedCardId: 'task-123',
    title: 'Finish the subtasks first',
  })
})

test('never exposes unknown technical details in generic board errors', () => {
  const error = presentKanbanError(
    'save',
    new Error(
      "Error invoking remote method 'kanban:updateCard': ECONNRESET at ipcMain.handle",
    ),
    'task-456',
  )
  const visibleCopy = JSON.stringify(error).toLocaleLowerCase()

  assert.equal(error.title, 'Changes weren’t saved')
  assert.equal(error.relatedCardId, 'task-456')
  assert.doesNotMatch(visibleCopy, /remote method|kanban:|econnreset|ipcmain/u)
})
