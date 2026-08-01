import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { mock } from 'node:test'
import {
  createKanbanBoardTask,
  deleteKanbanBoardCard,
  getKanbanBoardData,
  moveKanbanBoardCard,
  reorderKanbanBoardCard,
  updateKanbanBoardCardContent,
} from '../../electron/kanban/store'
import { parseKanbanBoardData } from '../../src/lib/kanban'

test('creates a parent and structured subtasks in one persisted mutation', async () => {
  const tempRootPath = await fs.mkdtemp(
    path.join(tmpdir(), 'tidecode-kanban-task-create-'),
  )
  const workspaceRootPath = path.join(tempRootPath, 'workspace')
  mock.method(os, 'homedir', () => path.join(tempRootPath, 'home'))
  await fs.mkdir(workspaceRootPath, { recursive: true })

  try {
    const result = await createKanbanBoardTask({
      acceptanceCriteria: [{ text: 'The new flow is covered by tests.' }],
      assignee: 'Echo',
      description: 'Build the complete workflow.',
      issueType: 'task',
      labels: ['kanban', 'reliability', 'kanban'],
      priority: 'high',
      subtasks: [
        { priority: 'high', title: 'Build the domain operation' },
        { title: 'Add the task composer' },
        { title: 'Cover the flow with tests' },
      ],
      title: 'Ship reliable task creation',
      workspacePath: workspaceRootPath,
    })

    assert.equal(result.subtasks.length, 3)
    assert.equal(result.parent.acceptanceCriteria.length, 1)
    assert.deepEqual(result.parent.labels, ['kanban', 'reliability'])
    assert.equal(result.parent.priority, 'high')
    assert.ok(
      result.subtasks.every(
        (subtask) => subtask.parentCardId === result.parent.id,
      ),
    )

    const persistedBoard = await getKanbanBoardData({
      workspacePath: workspaceRootPath,
    })
    assert.equal(persistedBoard.cards.length, 4)
    assert.equal(persistedBoard.revision, 1)
    assert.deepEqual(
      persistedBoard.cards
        .filter((card) => card.parentCardId === result.parent.id)
        .sort((left, right) => left.position - right.position)
        .map((card) => card.title),
      [
        'Build the domain operation',
        'Add the task composer',
        'Cover the flow with tests',
      ],
    )
  } finally {
    mock.restoreAll()
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})

test('guards completion and deletion when structured child work is incomplete', async () => {
  const tempRootPath = await fs.mkdtemp(
    path.join(tmpdir(), 'tidecode-kanban-task-guards-'),
  )
  const workspaceRootPath = path.join(tempRootPath, 'workspace')
  mock.method(os, 'homedir', () => path.join(tempRootPath, 'home'))
  await fs.mkdir(workspaceRootPath, { recursive: true })

  try {
    const result = await createKanbanBoardTask({
      acceptanceCriteria: [{ text: 'All behavior is verified.' }],
      subtasks: [{ title: 'Verify the behavior' }],
      title: 'Protected parent task',
      workspacePath: workspaceRootPath,
    })

    await assert.rejects(
      moveKanbanBoardCard({
        cardId: result.parent.id,
        targetColumnId: 'done',
        workspacePath: workspaceRootPath,
      }),
      /all subtasks are done/u,
    )
    await assert.rejects(
      deleteKanbanBoardCard({
        cardId: result.parent.id,
        workspacePath: workspaceRootPath,
      }),
      /Confirm that its subtasks should be deleted too/u,
    )

    await moveKanbanBoardCard({
      cardId: result.subtasks[0].id,
      targetColumnId: 'done',
      workspacePath: workspaceRootPath,
    })
    await updateKanbanBoardCardContent({
      acceptanceCriteria: result.parent.acceptanceCriteria.map((criterion) => ({
        ...criterion,
        completed: true,
      })),
      cardId: result.parent.id,
      workspacePath: workspaceRootPath,
    })
    await moveKanbanBoardCard({
      cardId: result.parent.id,
      targetColumnId: 'done',
      workspacePath: workspaceRootPath,
    })

    const deletedBoard = await deleteKanbanBoardCard({
      cardId: result.parent.id,
      deleteSubtasks: true,
      workspacePath: workspaceRootPath,
    })
    assert.equal(deletedBoard.cards.length, 0)
  } finally {
    mock.restoreAll()
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})

test('reorders tasks and migrates legacy cards to the richer schema', async () => {
  const legacyBoard = parseKanbanBoardData({
    cards: [
      {
        columnId: 'backlog',
        createdAt: 10,
        description: '',
        id: 'legacy',
        title: 'Legacy task',
        updatedAt: 10,
      },
    ],
  })
  assert.equal(legacyBoard.revision, 0)
  assert.deepEqual(legacyBoard.cards[0].acceptanceCriteria, [])
  assert.equal(legacyBoard.cards[0].issueType, 'task')
  assert.equal(legacyBoard.cards[0].priority, 'none')
  assert.equal(legacyBoard.cards[0].position, 10)

  const tempRootPath = await fs.mkdtemp(
    path.join(tmpdir(), 'tidecode-kanban-task-reorder-'),
  )
  const workspaceRootPath = path.join(tempRootPath, 'workspace')
  mock.method(os, 'homedir', () => path.join(tempRootPath, 'home'))
  await fs.mkdir(workspaceRootPath, { recursive: true })

  try {
    await createKanbanBoardTask({
      subtasks: [],
      title: 'First',
      workspacePath: workspaceRootPath,
    })
    const second = await createKanbanBoardTask({
      subtasks: [],
      title: 'Second',
      workspacePath: workspaceRootPath,
    })
    await reorderKanbanBoardCard({
      cardId: second.parent.id,
      targetColumnId: 'backlog',
      targetIndex: 0,
      workspacePath: workspaceRootPath,
    })
    const board = await getKanbanBoardData({
      workspacePath: workspaceRootPath,
    })
    assert.deepEqual(
      board.cards
        .sort((left, right) => left.position - right.position)
        .map((card) => card.title),
      ['Second', 'First'],
    )
    assert.ok(board.revision >= 3)
  } finally {
    mock.restoreAll()
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})
