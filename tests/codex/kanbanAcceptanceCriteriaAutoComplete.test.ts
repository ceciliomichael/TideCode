import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { mock } from 'node:test'
import {
  createKanbanBoardCard,
  getKanbanCard,
  moveKanbanBoardCard,
  updateKanbanBoardCardContent,
} from '../../electron/kanban/store'

test('moving a task to done requires all acceptance criteria to be complete', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-kanban-ac-'))
  const workspaceRootPath = path.join(tempRootPath, 'workspace')
  const kanbanHomePath = path.join(tempRootPath, 'home')

  await fs.mkdir(workspaceRootPath, { recursive: true })
  mock.method(os, 'homedir', () => kanbanHomePath)

  try {
    const card = await createKanbanBoardCard({
      acceptanceCriteria: [
        { completed: false, text: 'Criteria 1' },
        { completed: false, text: 'Criteria 2' },
      ],
      description: 'Test card description',
      title: 'Task with criteria',
      workspacePath: workspaceRootPath,
    })

    assert.equal(card.acceptanceCriteria.every((c) => !c.completed), true)

    // Moving to done directly with incomplete criteria must throw an error
    await assert.rejects(
      moveKanbanBoardCard({
        cardId: card.id,
        targetColumnId: 'done',
        workspacePath: workspaceRootPath,
      }),
      /all acceptance criteria are complete/u,
    )

    // Once updated with completed criteria, moving to done succeeds
    await updateKanbanBoardCardContent({
      acceptanceCriteria: [
        { completed: true, text: 'Criteria 1' },
        { completed: true, text: 'Criteria 2' },
      ],
      cardId: card.id,
      workspacePath: workspaceRootPath,
    })

    const movedCard = await moveKanbanBoardCard({
      cardId: card.id,
      targetColumnId: 'done',
      workspacePath: workspaceRootPath,
    })

    assert.equal(movedCard.columnId, 'done')

    // Verify stored details
    const stored = await getKanbanCard({
      cardId: card.id,
      workspacePath: workspaceRootPath,
    })
    assert.equal(stored?.card.columnId, 'done')
    assert.equal(stored?.card.acceptanceCriteria.every((c) => c.completed), true)
  } finally {
    mock.restoreAll()
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})
