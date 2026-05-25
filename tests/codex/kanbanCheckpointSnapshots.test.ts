import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { mock } from 'node:test'
import { captureKanbanBoardSnapshotIfNeeded } from '../../electron/kanban/checkpoints'
import { createWorkspaceCheckpointStore } from '../../electron/workspace/checkpoints'
import { getKanbanBoardData, replaceKanbanBoardData } from '../../electron/kanban/store'

test('kanban snapshots restore with workspace checkpoint revert and redo', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-kanban-checkpoints-'))
  const workspaceRootPath = path.join(tempRootPath, 'workspace')
  const checkpointStorageRootPath = path.join(tempRootPath, 'checkpoint-storage')
  const kanbanHomePath = path.join(tempRootPath, 'home')

  await fs.mkdir(workspaceRootPath, { recursive: true })
  mock.method(os, 'homedir', () => kanbanHomePath)

  const checkpointStore = createWorkspaceCheckpointStore(checkpointStorageRootPath)
  const initialBoardData = {
    cards: [
      {
        columnId: 'backlog' as const,
        createdAt: 1,
        description: 'Before revert',
        id: 'card-parent',
        title: 'Initial parent task',
        updatedAt: 1,
      },
      {
        columnId: 'backlog' as const,
        createdAt: 2,
        description: 'Before revert',
        id: 'card-child',
        parentCardId: 'card-parent',
        title: 'Initial child task',
        updatedAt: 2,
      },
    ],
  }
  const revertedBoardData = {
    cards: [
      {
        columnId: 'done' as const,
        createdAt: 1,
        description: 'After revert',
        id: 'card-parent',
        title: 'Updated parent task',
        updatedAt: 2,
      },
      {
        columnId: 'done' as const,
        createdAt: 2,
        description: 'After revert',
        id: 'card-child',
        parentCardId: 'card-parent',
        title: 'Updated child task',
        updatedAt: 3,
      },
    ],
  }

  try {
    const checkpoint = await checkpointStore.createCheckpoint({
      workspaceRootPath,
    })

    await replaceKanbanBoardData({
      ...initialBoardData,
      workspacePath: workspaceRootPath,
    })
    await captureKanbanBoardSnapshotIfNeeded({
      boardData: initialBoardData,
      checkpointId: checkpoint.id,
      workspacePath: workspaceRootPath,
    })

    await replaceKanbanBoardData({
      ...revertedBoardData,
      workspacePath: workspaceRootPath,
    })

    const redoCheckpoint = await checkpointStore.createRedoCheckpointFromSource(checkpoint.id)

    await checkpointStore.restoreCheckpoint(checkpoint.id)
    assert.deepEqual(await getKanbanBoardData({ workspacePath: workspaceRootPath }), initialBoardData)

    await checkpointStore.restoreCheckpoint(redoCheckpoint.id)
    assert.deepEqual(await getKanbanBoardData({ workspacePath: workspaceRootPath }), revertedBoardData)
  } finally {
    mock.restoreAll()
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})
