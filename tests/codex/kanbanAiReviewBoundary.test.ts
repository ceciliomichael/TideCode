import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { mock } from 'node:test'
import type { ToolExecutionOptions } from 'ai'
import { createAgentTools } from '../../electron/chat/shared/tools'
import { getKanbanBoardData, replaceKanbanBoardData } from '../../electron/kanban/store'

type ExecutableTool = {
  execute?: (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown>
}

async function invoke(tool: unknown, input: unknown) {
  const execute = (tool as ExecutableTool).execute
  assert.equal(typeof execute, 'function')
  return await execute?.(input, {
    context: {},
    messages: [],
    toolCallId: 'test-kanban-ai-review-boundary',
  }) as { body?: string; status?: string; summary?: string }
}

test('AI Kanban mutations reserve done for the user and auto-complete parents to for-review', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-kanban-ai-review-'))
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
          columnId: 'done',
          createdAt: 2,
          description: 'Reviewed child',
          id: 'done-child',
          parentCardId: 'parent-card',
          title: 'Done child',
          updatedAt: 2,
        },
        {
          columnId: 'backlog',
          createdAt: 3,
          description: 'Remaining child',
          id: 'remaining-child',
          parentCardId: 'parent-card',
          title: 'Remaining child',
          updatedAt: 3,
        },
      ],
      workspacePath: workspaceRootPath,
    })

    const tools = await createAgentTools(
      { workspaceRootPath },
      { chatMode: 'agent', providerId: 'custom:test-provider' },
    )
    const kanbanTool = tools.kanban_board
    assert.ok(kanbanTool)

    for (const input of [
      { action: 'create_card', columnId: 'done', title: 'Nope' },
      { action: 'create_task_with_subtasks', columnId: 'done', title: 'Nope' },
      { action: 'update_card', cardId: 'parent-card', columnId: 'done' },
      { action: 'move_card', cardId: 'parent-card', columnId: 'done' },
      { action: 'reorder_card', cardId: 'parent-card', columnId: 'done', targetIndex: 0 },
    ]) {
      const result = await invoke(kanbanTool, input)
      assert.equal(result.status, 'error')
      assert.equal(
        result.summary,
        'AI Kanban actions cannot directly target done. Move completed main work to for-review; only the user approves main tasks as Done.',
      )
    }

    const deleteResult = await invoke(kanbanTool, {
      action: 'delete_card',
      cardId: 'remaining-child',
    })
    assert.equal(deleteResult.status, 'success')

    const boardData = await getKanbanBoardData({ workspacePath: workspaceRootPath })
    assert.equal(boardData.cards.find((card) => card.id === 'parent-card')?.columnId, 'for-review')
    assert.equal(boardData.cards.find((card) => card.id === 'done-child')?.columnId, 'done')
  } finally {
    mock.restoreAll()
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})

test('AI for-review handoff completes direct subtasks without approving the parent as done', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-kanban-ai-handoff-'))
  const workspaceRootPath = path.join(tempRootPath, 'workspace')
  const kanbanHomePath = path.join(tempRootPath, 'home')

  await fs.mkdir(workspaceRootPath, { recursive: true })
  mock.method(os, 'homedir', () => kanbanHomePath)

  try {
    await replaceKanbanBoardData({
      cards: [
        { columnId: 'in-progress', createdAt: 1, description: '', id: 'parent', title: 'Parent', updatedAt: 1 },
        { columnId: 'backlog', createdAt: 2, description: '', id: 'child-a', parentCardId: 'parent', title: 'Child A', updatedAt: 2 },
        { columnId: 'in-progress', createdAt: 3, description: '', id: 'child-b', parentCardId: 'parent', title: 'Child B', updatedAt: 3 },
      ],
      workspacePath: workspaceRootPath,
    })

    const tools = await createAgentTools(
      { workspaceRootPath },
      { chatMode: 'agent', providerId: 'custom:test-provider' },
    )
    const result = await invoke(tools.kanban_board, {
      action: 'move_card',
      cardId: 'parent',
      targetColumnId: 'for-review',
    })
    assert.equal(result.status, 'success')

    const boardData = await getKanbanBoardData({ workspacePath: workspaceRootPath })
    assert.equal(boardData.cards.find((card) => card.id === 'parent')?.columnId, 'for-review')
    assert.equal(boardData.cards.find((card) => card.id === 'child-a')?.columnId, 'done')
    assert.equal(boardData.cards.find((card) => card.id === 'child-b')?.columnId, 'done')
  } finally {
    mock.restoreAll()
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})

test('AI-created Kanban tasks preserve explicit provenance owners without inventing defaults or inheritance', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-kanban-ai-owner-'))
  const workspaceRootPath = path.join(tempRootPath, 'workspace')
  const kanbanHomePath = path.join(tempRootPath, 'home')

  await fs.mkdir(workspaceRootPath, { recursive: true })
  mock.method(os, 'homedir', () => kanbanHomePath)

  try {
    await replaceKanbanBoardData({
      cards: [
        {
          assignee: 'Ada',
          columnId: 'backlog',
          createdAt: 1,
          description: '',
          id: 'owned-parent',
          title: 'Owned parent',
          updatedAt: 1,
        },
      ],
      workspacePath: workspaceRootPath,
    })

    const tools = await createAgentTools(
      { workspaceRootPath },
      { chatMode: 'agent', providerId: 'custom:test-provider' },
    )
    const kanbanTool = tools.kanban_board
    assert.ok(kanbanTool)

    assert.equal((await invoke(kanbanTool, {
      action: 'create_card',
      title: 'Unassigned task',
    })).status, 'success')
    assert.equal((await invoke(kanbanTool, {
      action: 'create_card',
      parentCardId: 'owned-parent',
      title: 'Unassigned subtask',
    })).status, 'success')
    assert.equal((await invoke(kanbanTool, {
      action: 'create_card',
      assignee: 'Reviewer',
      parentCardId: 'owned-parent',
      title: 'Explicit owner subtask',
    })).status, 'success')
    assert.equal((await invoke(kanbanTool, {
      action: 'create_task_with_subtasks',
      assignee: 'Human',
      subtasks: [
        { assignee: 'Agent', title: 'Agent-created decomposition' },
        { assignee: 'Human', title: 'Human-requested subtask' },
        { title: 'Unassigned bundle subtask' },
        { assignee: 'Specialist', title: 'Explicit bundle subtask' },
      ],
      title: 'Human brainstormed task',
    })).status, 'success')

    const boardData = await getKanbanBoardData({ workspacePath: workspaceRootPath })
    assert.equal(boardData.cards.find((card) => card.title === 'Unassigned task')?.assignee, undefined)
    assert.equal(boardData.cards.find((card) => card.title === 'Unassigned subtask')?.assignee, undefined)
    assert.equal(boardData.cards.find((card) => card.title === 'Explicit owner subtask')?.assignee, 'Reviewer')

    const bundle = boardData.cards.find((card) => card.title === 'Human brainstormed task')
    assert.equal(bundle?.assignee, 'Human')
    assert.equal(boardData.cards.find((card) => card.title === 'Agent-created decomposition')?.assignee, 'Agent')
    assert.equal(boardData.cards.find((card) => card.title === 'Human-requested subtask')?.assignee, 'Human')
    assert.equal(boardData.cards.find((card) => card.title === 'Unassigned bundle subtask')?.assignee, undefined)
    assert.equal(boardData.cards.find((card) => card.title === 'Explicit bundle subtask')?.assignee, 'Specialist')
  } finally {
    mock.restoreAll()
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})
