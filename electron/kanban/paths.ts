import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const KANBAN_ROOT_SEGMENTS = ['.echosphere', 'kanban'] as const
const BOARD_DIRECTORY_NAME = 'boards'

export function getKanbanDirectoryPath() {
  return path.join(app.getPath('home'), ...KANBAN_ROOT_SEGMENTS)
}

export function getKanbanBoardsDirectoryPath() {
  return path.join(getKanbanDirectoryPath(), BOARD_DIRECTORY_NAME)
}

export async function ensureKanbanBoardsDirectory() {
  await fs.mkdir(getKanbanBoardsDirectoryPath(), { recursive: true })
}
