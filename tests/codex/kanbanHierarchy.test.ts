import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { mock } from 'node:test'
import {
  createKanbanBoardCard,
  getKanbanBoardData,
  getKanbanCard,
  moveKanbanBoardCard,
  readKanbanBoardColumn,
  replaceKanbanBoardData,
} from '../../electron/kanban/store'

test('kanban parent tasks expose child progress and auto-complete with subtasks', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-kanban-hierarchy-'))
  const workspaceRootPath = path.join(tempRootPath, 'workspace')
  const kanbanHomePath = path.join(tempRootPath, 'home')

  await fs.mkdir(workspaceRootPath, { recursive: true })
  mock.method(os, 'homedir', () => kanbanHomePath)

  try {
    const parent = await createKanbanBoardCard({
      description: 'Parent card',
      title: 'Parent task',
      workspacePath: workspaceRootPath,
    })
    const child = await createKanbanBoardCard({
      description: 'Child card',
      parentCardId: parent.id,
      title: 'Child task',
      workspacePath: workspaceRootPath,
    })

    const backlogRead = await readKanbanBoardColumn({
      columnId: 'backlog',
      includeCounts: true,
      workspacePath: workspaceRootPath,
    })

    assert.equal(backlogRead.column.count, 2)
    assert.equal(backlogRead.cards.find((card) => card.id === parent.id)?.childCount, 1)
    assert.equal(backlogRead.cards.find((card) => card.id === parent.id)?.doneChildCount, 0)
    assert.equal(backlogRead.cards.find((card) => card.id === child.id)?.parentCardId, parent.id)

    await assert.rejects(
      moveKanbanBoardCard({
        cardId: parent.id,
        targetColumnId: 'done',
        workspacePath: workspaceRootPath,
      }),
      /all subtasks are done/u,
    )

    await moveKanbanBoardCard({
      cardId: child.id,
      targetColumnId: 'done',
      workspacePath: workspaceRootPath,
    })

    const parentDetails = await getKanbanCard({
      cardId: parent.id,
      workspacePath: workspaceRootPath,
    })
    assert.equal(parentDetails?.card.columnId, 'done')
    assert.equal(parentDetails?.childCount, 1)
    assert.equal(parentDetails?.doneChildCount, 1)

    const boardData = await getKanbanBoardData({ workspacePath: workspaceRootPath })
    assert.equal(boardData.cards.find((card) => card.id === parent.id)?.columnId, 'done')
    assert.equal(boardData.cards.find((card) => card.id === child.id)?.columnId, 'done')
  } finally {
    mock.restoreAll()
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})

test('kanban hierarchy survives persistence round trips', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-kanban-hierarchy-persist-'))
  const workspaceRootPath = path.join(tempRootPath, 'workspace')
  const kanbanHomePath = path.join(tempRootPath, 'home')

  await fs.mkdir(workspaceRootPath, { recursive: true })
  mock.method(os, 'homedir', () => kanbanHomePath)

  try {
    await replaceKanbanBoardData({
      cards: [
        {
          columnId: 'backlog',
          createdAt: 1,
          description: 'Parent card',
          id: 'parent-card',
          title: 'Parent task',
          updatedAt: 1,
        },
        {
          columnId: 'in-progress',
          createdAt: 2,
          description: 'Child card',
          id: 'child-card',
          parentCardId: 'parent-card',
          title: 'Child task',
          updatedAt: 2,
        },
      ],
      workspacePath: workspaceRootPath,
    })

    const boardData = await getKanbanBoardData({ workspacePath: workspaceRootPath })
    assert.equal(boardData.cards.find((card) => card.id === 'child-card')?.parentCardId, 'parent-card')

    const childDetails = await getKanbanCard({
      cardId: 'child-card',
      workspacePath: workspaceRootPath,
    })
    assert.equal(childDetails?.card.parentCardId, 'parent-card')
    assert.equal(childDetails?.card.columnId, 'in-progress')
  } finally {
    mock.restoreAll()
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})
