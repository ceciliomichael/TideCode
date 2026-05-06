import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  addKanbanCard,
  clearDoneKanbanCards,
  createKanbanCard,
  deleteKanbanCard,
  moveKanbanCard,
  normalizeKanbanWorkspacePath,
  parseKanbanBoardData,
  readKanbanCard,
  readKanbanColumn,
  updateKanbanCard,
  updateKanbanCardContent,
  type KanbanBoardData,
  type KanbanCard,
  type KanbanColumnReadResult,
  type KanbanCreateCardRequest,
  type KanbanDeleteCardRequest,
  type KanbanMoveCardRequest,
  type KanbanReadBoardRequest,
  type KanbanReadCardRequest,
  type KanbanUpdateCardInput,
  type KanbanUpdateCardRequest,
  type KanbanWorkspaceInput,
} from '../../src/lib/kanban'
import { KANBAN_COLUMNS } from '../../src/components/kanban/kanbanDefaults'
import { writeJsonFileAtomic } from '../settings/fileStore'
import { ensureKanbanBoardsDirectory, getKanbanBoardsDirectoryPath } from './paths'

interface PersistedKanbanBoard {
  cards: KanbanBoardData['cards']
  schemaVersion: 1
  updatedAt: number
  workspacePath: string
}

type KanbanBoardMutation<T> = (boardData: KanbanBoardData) => Promise<{ boardData: KanbanBoardData; result: T }>

const boardMutationQueues = new Map<string, Promise<unknown>>()

function getBoardFileName(workspacePath: string) {
  return `${createHash('sha256').update(workspacePath).digest('hex')}.json`
}

function getBoardFilePath(workspacePath: string) {
  return path.join(getKanbanBoardsDirectoryPath(), getBoardFileName(workspacePath))
}

function parsePersistedKanbanBoard(value: unknown): KanbanBoardData {
  return parseKanbanBoardData(value)
}

async function readBoardDataForWorkspace(workspacePath: string): Promise<KanbanBoardData> {
  await ensureKanbanBoardsDirectory()

  try {
    const fileContent = await fs.readFile(getBoardFilePath(workspacePath), 'utf8')
    return parsePersistedKanbanBoard(JSON.parse(fileContent))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { cards: [] }
    }

    console.error(`Failed to read kanban board for workspace: ${workspacePath}`, error)
    throw error
  }
}

async function writeBoardDataForWorkspace(workspacePath: string, boardData: KanbanBoardData) {
  await ensureKanbanBoardsDirectory()

  const payload: PersistedKanbanBoard = {
    cards: boardData.cards,
    schemaVersion: 1,
    updatedAt: Date.now(),
    workspacePath,
  }

  await writeJsonFileAtomic(getBoardFilePath(workspacePath), JSON.stringify(payload, null, 2))
}

async function mutateBoardData<T>(workspacePathInput: string | null | undefined, mutation: KanbanBoardMutation<T>) {
  const workspacePath = normalizeKanbanWorkspacePath(workspacePathInput)
  const previousQueue = boardMutationQueues.get(workspacePath) ?? Promise.resolve()

  const nextQueue = previousQueue
    .catch(() => undefined)
    .then(async () => {
      const currentBoardData = await readBoardDataForWorkspace(workspacePath)
      const { boardData, result } = await mutation(currentBoardData)
      await writeBoardDataForWorkspace(workspacePath, boardData)
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

export async function getKanbanBoardData(input: KanbanWorkspaceInput): Promise<KanbanBoardData> {
  const workspacePath = normalizeKanbanWorkspacePath(input.workspacePath)
  return readBoardDataForWorkspace(workspacePath)
}

export async function importKanbanBoardData(input: KanbanWorkspaceInput & KanbanBoardData): Promise<KanbanBoardData> {
  return mutateBoardData(input.workspacePath, async (currentBoardData) => {
    if (currentBoardData.cards.length > 0) {
      return { boardData: currentBoardData, result: currentBoardData }
    }

    const boardData = parseKanbanBoardData(input)
    return { boardData, result: boardData }
  })
}

export async function readKanbanBoardColumn(input: KanbanReadBoardRequest): Promise<KanbanColumnReadResult> {
  const boardData = await getKanbanBoardData(input)
  return readKanbanColumn(boardData, KANBAN_COLUMNS, input)
}

export async function getKanbanCard(input: KanbanReadCardRequest): Promise<KanbanCard | null> {
  const boardData = await getKanbanBoardData(input)
  return readKanbanCard(boardData, input)
}

export async function createKanbanBoardCard(input: KanbanCreateCardRequest): Promise<KanbanCard> {
  return mutateBoardData(input.workspacePath, async (currentBoardData) => {
    const card = createKanbanCard(input, randomUUID())
    const boardData = addKanbanCard(currentBoardData, card)
    return { boardData, result: card }
  })
}

export async function updateKanbanBoardCardContent(input: KanbanUpdateCardRequest): Promise<KanbanCard> {
  return mutateBoardData(input.workspacePath, async (currentBoardData) => {
    const boardData = updateKanbanCardContent(currentBoardData, input)
    const updatedCard = readKanbanCard(boardData, input)
    if (!updatedCard) {
      throw new Error(`Task not found after update: ${input.cardId}`)
    }

    return { boardData, result: updatedCard }
  })
}

export async function updateKanbanBoardCard(input: KanbanWorkspaceInput & KanbanUpdateCardInput): Promise<KanbanCard> {
  return mutateBoardData(input.workspacePath, async (currentBoardData) => {
    const boardData = updateKanbanCard(currentBoardData, input)
    const updatedCard = readKanbanCard(boardData, input)
    if (!updatedCard) {
      throw new Error(`Task not found after update: ${input.cardId}`)
    }

    return { boardData, result: updatedCard }
  })
}

export async function moveKanbanBoardCard(input: KanbanMoveCardRequest): Promise<KanbanCard> {
  return mutateBoardData(input.workspacePath, async (currentBoardData) => {
    const boardData = moveKanbanCard(currentBoardData, input)
    const movedCard = readKanbanCard(boardData, input)
    if (!movedCard) {
      throw new Error(`Task not found after move: ${input.cardId}`)
    }

    return { boardData, result: movedCard }
  })
}

export async function deleteKanbanBoardCard(input: KanbanDeleteCardRequest): Promise<KanbanBoardData> {
  return mutateBoardData(input.workspacePath, async (currentBoardData) => {
    const boardData = deleteKanbanCard(currentBoardData, input)
    return { boardData, result: boardData }
  })
}

export async function clearCompletedKanbanBoardCards(input: KanbanWorkspaceInput): Promise<KanbanBoardData> {
  return mutateBoardData(input.workspacePath, async (currentBoardData) => {
    const boardData = clearDoneKanbanCards(currentBoardData)
    return { boardData, result: boardData }
  })
}
