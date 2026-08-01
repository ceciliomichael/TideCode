import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const KANBAN_ROOT_SEGMENTS = ['.tidecode', 'kanban'] as const
const BOARD_DIRECTORY_NAME = 'boards'
const CHECKPOINT_DIRECTORY_NAME = 'checkpoints'

export function getKanbanDirectoryPath() {
  return path.join(os.homedir(), ...KANBAN_ROOT_SEGMENTS)
}

export function getKanbanBoardsDirectoryPath() {
  return path.join(getKanbanDirectoryPath(), BOARD_DIRECTORY_NAME)
}

export function getKanbanCheckpointsDirectoryPath() {
  return path.join(getKanbanDirectoryPath(), CHECKPOINT_DIRECTORY_NAME)
}

export async function ensureKanbanBoardsDirectory() {
  await fs.mkdir(getKanbanBoardsDirectoryPath(), { recursive: true })
}

export async function ensureKanbanCheckpointsDirectory() {
  await fs.mkdir(getKanbanCheckpointsDirectoryPath(), { recursive: true })
}
