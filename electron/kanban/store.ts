import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  addKanbanCard,
  clearDoneKanbanCards,
  createKanbanCard,
  deleteKanbanCard,
  getKanbanCardDetails,
  moveKanbanCard,
  normalizeKanbanWorkspacePath,
  normalizeKanbanBoardData,
  parseKanbanBoardData,
  readKanbanCard,
  readKanbanColumn,
  reorderKanbanCard,
  updateKanbanCard,
  updateKanbanCardContent,
  type KanbanBoardData,
  type KanbanCardDetails,
  type KanbanCard,
  type KanbanColumnReadResult,
  type KanbanCreateCardRequest,
  type KanbanCreateTaskRequest,
  type KanbanCreateTaskResult,
  type KanbanDeleteCardRequest,
  type KanbanMoveCardRequest,
  type KanbanReadBoardRequest,
  type KanbanReadCardRequest,
  type KanbanReorderCardRequest,
  type KanbanUpdateCardInput,
  type KanbanUpdateCardRequest,
  type KanbanWorkspaceInput,
} from '../../src/lib/kanban'
import { KANBAN_COLUMNS } from '../../src/components/kanban/kanbanDefaults'
import { writeJsonFileAtomic } from '../settings/fileStore'
import {
  ensureKanbanBoardsDirectory,
  getKanbanBoardsDirectoryPath,
} from './paths'
import { notifyKanbanBoardChange } from './watch'

interface PersistedKanbanBoard {
  cards: KanbanBoardData['cards']
  revision: number
  schemaVersion: 2
  updatedAt: number
  workspacePath: string
}

type KanbanBoardMutation<T> = (
  boardData: KanbanBoardData,
) => Promise<{ boardData: KanbanBoardData; result: T }>

const boardMutationQueues = new Map<string, Promise<unknown>>()

function getBoardFileName(workspacePath: string) {
  return `${createHash('sha256').update(workspacePath).digest('hex')}.json`
}

function getBoardFilePath(workspacePath: string) {
  return path.join(
    getKanbanBoardsDirectoryPath(),
    getBoardFileName(workspacePath),
  )
}

function parsePersistedKanbanBoard(value: unknown): KanbanBoardData {
  return parseKanbanBoardData(value)
}

function normalizeBoardData(boardData: KanbanBoardData): KanbanBoardData {
  return normalizeKanbanBoardData(boardData)
}

async function readBoardDataForWorkspace(
  workspacePath: string,
): Promise<KanbanBoardData> {
  await ensureKanbanBoardsDirectory()

  try {
    const fileContent = await fs.readFile(
      getBoardFilePath(workspacePath),
      'utf8',
    )
    return normalizeBoardData(
      parsePersistedKanbanBoard(JSON.parse(fileContent)),
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { cards: [], revision: 0 }
    }

    console.error(
      `Failed to read kanban board for workspace: ${workspacePath}`,
      error,
    )
    throw error
  }
}

async function writeBoardDataForWorkspace(
  workspacePath: string,
  boardData: KanbanBoardData,
) {
  await ensureKanbanBoardsDirectory()
  const normalizedBoardData = normalizeBoardData(boardData)

  const payload: PersistedKanbanBoard = {
    cards: normalizedBoardData.cards,
    revision: normalizedBoardData.revision,
    schemaVersion: 2,
    updatedAt: Date.now(),
    workspacePath,
  }

  await writeJsonFileAtomic(
    getBoardFilePath(workspacePath),
    JSON.stringify(payload, null, 2),
  )
}

async function replaceBoardDataForWorkspace(
  workspacePath: string,
  boardData: KanbanBoardData,
) {
  return mutateBoardData(workspacePath, async () => {
    return {
      boardData: normalizeBoardData(boardData),
      result: normalizeBoardData(boardData),
    }
  })
}

async function mutateBoardData<T>(
  workspacePathInput: string | null | undefined,
  mutation: KanbanBoardMutation<T>,
) {
  const workspacePath = normalizeKanbanWorkspacePath(workspacePathInput)
  const previousQueue =
    boardMutationQueues.get(workspacePath) ?? Promise.resolve()

  const nextQueue = previousQueue
    .catch(() => undefined)
    .then(async () => {
      const currentBoardData = await readBoardDataForWorkspace(workspacePath)
      const { boardData, result } = await mutation(currentBoardData)
      const revisionedBoardData = {
        ...boardData,
        revision: currentBoardData.revision + 1,
      }
      await writeBoardDataForWorkspace(workspacePath, revisionedBoardData)
      void notifyKanbanBoardChange(workspacePath)
      return result
    })
    .finally(() => {
      if (boardMutationQueues.get(workspacePath) === nextQueue) {
        boardMutationQueues.delete(workspacePath)
      }
    })

  boardMutationQueues.set(workspacePath, nextQueue)
  return nextQueue
}

export async function getKanbanBoardData(
  input: KanbanWorkspaceInput,
): Promise<KanbanBoardData> {
  const workspacePath = normalizeKanbanWorkspacePath(input.workspacePath)
  return readBoardDataForWorkspace(workspacePath)
}

export async function importKanbanBoardData(
  input: KanbanWorkspaceInput & KanbanBoardData,
): Promise<KanbanBoardData> {
  return mutateBoardData(input.workspacePath, async (currentBoardData) => {
    if (currentBoardData.cards.length > 0) {
      return { boardData: currentBoardData, result: currentBoardData }
    }

    const boardData = normalizeBoardData(parseKanbanBoardData(input))
    return { boardData, result: boardData }
  })
}

export async function replaceKanbanBoardData(
  input: KanbanWorkspaceInput & KanbanBoardData,
): Promise<KanbanBoardData> {
  const boardData = normalizeBoardData(parseKanbanBoardData(input))
  const workspacePath = normalizeKanbanWorkspacePath(input.workspacePath)
  return replaceBoardDataForWorkspace(workspacePath, boardData)
}

export async function readKanbanBoardColumn(
  input: KanbanReadBoardRequest,
): Promise<KanbanColumnReadResult> {
  const boardData = await getKanbanBoardData(input)
  return readKanbanColumn(boardData, KANBAN_COLUMNS, input)
}

function syncParentTaskState(
  boardData: KanbanBoardData,
  parentCardId: string,
  now = Date.now(),
): KanbanBoardData {
  const parentCard = readKanbanCard(boardData, { cardId: parentCardId })
  if (!parentCard || parentCard.parentCardId !== undefined) {
    return boardData
  }

  const directChildren = boardData.cards.filter(
    (card) => card.parentCardId === parentCard.id,
  )
  if (directChildren.length === 0) {
    return boardData
  }

  const allChildrenDone = directChildren.every(
    (card) => card.columnId === 'done',
  )
  const allAcceptanceCriteriaDone = parentCard.acceptanceCriteria.every(
    (criterion) => criterion.completed,
  )
  if (
    allChildrenDone &&
    allAcceptanceCriteriaDone &&
    parentCard.columnId !== 'done'
  ) {
    return moveKanbanCard(
      boardData,
      { cardId: parentCard.id, targetColumnId: 'done' },
      now,
    )
  }

  if (!allChildrenDone && parentCard.columnId === 'done') {
    return moveKanbanCard(
      boardData,
      { cardId: parentCard.id, targetColumnId: 'in-progress' },
      now,
    )
  }

  return boardData
}

export async function getKanbanCard(
  input: KanbanReadCardRequest,
): Promise<KanbanCardDetails | null> {
  const boardData = await getKanbanBoardData(input)
  return getKanbanCardDetails(boardData, input)
}

export async function createKanbanBoardCard(
  input: KanbanCreateCardRequest,
): Promise<KanbanCard> {
  return mutateBoardData(input.workspacePath, async (currentBoardData) => {
    const lastPosition = currentBoardData.cards
      .filter((card) => card.columnId === (input.columnId ?? 'backlog'))
      .reduce((maximum, card) => Math.max(maximum, card.position), 0)
    const card = createKanbanCard(
      {
        ...input,
        position: input.position ?? lastPosition + 1024,
      },
      randomUUID(),
    )
    let boardData = addKanbanCard(currentBoardData, card)
    if (card.parentCardId) {
      boardData = syncParentTaskState(boardData, card.parentCardId)
    }
    return { boardData, result: card }
  })
}

export async function createKanbanBoardTask(
  input: KanbanCreateTaskRequest,
): Promise<KanbanCreateTaskResult> {
  return mutateBoardData(input.workspacePath, async (currentBoardData) => {
    const parentColumnId = input.columnId ?? 'backlog'
    const parentPosition =
      currentBoardData.cards
        .filter((card) => card.columnId === parentColumnId)
        .reduce((maximum, card) => Math.max(maximum, card.position), 0) + 1024
    const parent = createKanbanCard(
      {
        ...input,
        parentCardId: input.parentCardId,
        position: input.position ?? parentPosition,
      },
      randomUUID(),
    )
    let boardData = addKanbanCard(currentBoardData, parent)
    const subtasks: KanbanCard[] = []

    for (const [index, subtaskInput] of (input.subtasks ?? []).entries()) {
      const subtask = createKanbanCard(
        {
          ...subtaskInput,
          columnId: subtaskInput.columnId ?? parent.columnId,
          parentCardId: parent.id,
          position: parent.position + (index + 1) / 100,
        },
        randomUUID(),
      )
      boardData = addKanbanCard(boardData, subtask)
      subtasks.push(subtask)
    }

    return {
      boardData,
      result: {
        parent,
        subtasks,
      },
    }
  })
}

export async function updateKanbanBoardCardContent(
  input: KanbanUpdateCardRequest,
): Promise<KanbanCard> {
  return mutateBoardData(input.workspacePath, async (currentBoardData) => {
    const currentCard = readKanbanCard(currentBoardData, input)
    const previousParentCardId = currentCard?.parentCardId
    const boardData = updateKanbanCardContent(currentBoardData, input)
    const updatedCard = readKanbanCard(boardData, input)
    if (!updatedCard) {
      throw new Error(`Task not found after update: ${input.cardId}`)
    }

    let nextBoardData = boardData
    if (previousParentCardId) {
      nextBoardData = syncParentTaskState(nextBoardData, previousParentCardId)
    }
    if (updatedCard.parentCardId) {
      nextBoardData = syncParentTaskState(
        nextBoardData,
        updatedCard.parentCardId,
      )
    }

    return { boardData: nextBoardData, result: updatedCard }
  })
}

export async function updateKanbanBoardCard(
  input: KanbanWorkspaceInput & KanbanUpdateCardInput,
): Promise<KanbanCard> {
  return mutateBoardData(input.workspacePath, async (currentBoardData) => {
    const boardData = updateKanbanCard(currentBoardData, input)
    const updatedCard = readKanbanCard(boardData, input)
    if (!updatedCard) {
      throw new Error(`Task not found after update: ${input.cardId}`)
    }

    let nextBoardData = boardData
    if (updatedCard.parentCardId) {
      nextBoardData = syncParentTaskState(
        nextBoardData,
        updatedCard.parentCardId,
      )
    }

    return { boardData: nextBoardData, result: updatedCard }
  })
}

export async function moveKanbanBoardCard(
  input: KanbanMoveCardRequest,
): Promise<KanbanCard> {
  return mutateBoardData(input.workspacePath, async (currentBoardData) => {
    const boardData = moveKanbanCard(currentBoardData, input)
    const movedCard = readKanbanCard(boardData, input)
    if (!movedCard) {
      throw new Error(`Task not found after move: ${input.cardId}`)
    }

    let nextBoardData = boardData
    if (movedCard.parentCardId) {
      nextBoardData = syncParentTaskState(nextBoardData, movedCard.parentCardId)
    }

    return { boardData: nextBoardData, result: movedCard }
  })
}

export async function reorderKanbanBoardCard(
  input: KanbanReorderCardRequest,
): Promise<KanbanCard> {
  return mutateBoardData(input.workspacePath, async (currentBoardData) => {
    const boardData = reorderKanbanCard(currentBoardData, input)
    const reorderedCard = readKanbanCard(boardData, input)
    if (!reorderedCard) {
      throw new Error(`Task not found after reorder: ${input.cardId}`)
    }

    let nextBoardData = boardData
    if (reorderedCard.parentCardId) {
      nextBoardData = syncParentTaskState(
        nextBoardData,
        reorderedCard.parentCardId,
      )
    }

    return { boardData: nextBoardData, result: reorderedCard }
  })
}

export async function deleteKanbanBoardCard(
  input: KanbanDeleteCardRequest,
): Promise<KanbanBoardData> {
  return mutateBoardData(input.workspacePath, async (currentBoardData) => {
    const currentCard = readKanbanCard(currentBoardData, input)
    const boardData = deleteKanbanCard(currentBoardData, input)
    const nextBoardData = currentCard?.parentCardId
      ? syncParentTaskState(boardData, currentCard.parentCardId)
      : boardData
    return { boardData: nextBoardData, result: nextBoardData }
  })
}

export async function clearCompletedKanbanBoardCards(
  input: KanbanWorkspaceInput,
): Promise<KanbanBoardData> {
  return mutateBoardData(input.workspacePath, async (currentBoardData) => {
    const boardData = clearDoneKanbanCards(currentBoardData)
    return { boardData, result: boardData }
  })
}
