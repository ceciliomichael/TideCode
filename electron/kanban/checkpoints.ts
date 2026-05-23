import { promises as fs } from 'node:fs'
import path from 'node:path'
import { writeJsonFileAtomic } from '../settings/fileStore'
import { ensureKanbanCheckpointsDirectory, getKanbanCheckpointsDirectoryPath } from './paths'
import type { KanbanBoardData } from '../../src/lib/kanban'

interface PersistedKanbanCheckpointSnapshot {
  boardData: KanbanBoardData
  checkpointId: string
  createdAt: number
  schemaVersion: 1
  workspacePath: string
}

export interface KanbanCheckpointSnapshot {
  boardData: KanbanBoardData
  checkpointId: string
  createdAt: number
  workspacePath: string
}

function normalizeCheckpointId(checkpointId: string) {
  const normalizedCheckpointId = checkpointId.trim()
  if (!normalizedCheckpointId) {
    throw new Error('checkpointId is required.')
  }

  return normalizedCheckpointId
}

function getCheckpointSnapshotFilePath(checkpointId: string) {
  return path.join(getKanbanCheckpointsDirectoryPath(), `${checkpointId}.json`)
}

function parseKanbanCheckpointSnapshot(value: unknown): KanbanCheckpointSnapshot | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const candidate = value as Partial<PersistedKanbanCheckpointSnapshot>
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.checkpointId !== 'string' ||
    typeof candidate.createdAt !== 'number' ||
    typeof candidate.workspacePath !== 'string' ||
    typeof candidate.boardData !== 'object' ||
    candidate.boardData === null ||
    !Array.isArray(candidate.boardData.cards)
  ) {
    return null
  }

  return {
    boardData: candidate.boardData,
    checkpointId: candidate.checkpointId,
    createdAt: candidate.createdAt,
    workspacePath: candidate.workspacePath,
  }
}

async function readKanbanCheckpointSnapshotFile(checkpointId: string) {
  await ensureKanbanCheckpointsDirectory()

  try {
    const fileContent = await fs.readFile(getCheckpointSnapshotFilePath(checkpointId), 'utf8')
    return parseKanbanCheckpointSnapshot(JSON.parse(fileContent))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    console.error(`Failed to read kanban checkpoint snapshot: ${checkpointId}`, error)
    throw error
  }
}

async function writeKanbanCheckpointSnapshotFile(snapshot: KanbanCheckpointSnapshot) {
  await ensureKanbanCheckpointsDirectory()

  const payload: PersistedKanbanCheckpointSnapshot = {
    boardData: snapshot.boardData,
    checkpointId: snapshot.checkpointId,
    createdAt: snapshot.createdAt,
    schemaVersion: 1,
    workspacePath: snapshot.workspacePath,
  }

  await writeJsonFileAtomic(getCheckpointSnapshotFilePath(snapshot.checkpointId), JSON.stringify(payload, null, 2))
}

export async function captureKanbanBoardSnapshotIfNeeded(input: {
  boardData: KanbanBoardData
  checkpointId: string
  workspacePath: string
}) {
  const checkpointId = normalizeCheckpointId(input.checkpointId)
  const existingSnapshot = await readKanbanCheckpointSnapshotFile(checkpointId)
  if (existingSnapshot) {
    return existingSnapshot
  }

  const snapshot: KanbanCheckpointSnapshot = {
    boardData: input.boardData,
    checkpointId,
    createdAt: Date.now(),
    workspacePath: input.workspacePath,
  }

  await writeKanbanCheckpointSnapshotFile(snapshot)
  return snapshot
}

export async function readKanbanBoardSnapshot(checkpointId: string): Promise<KanbanCheckpointSnapshot | null> {
  return readKanbanCheckpointSnapshotFile(normalizeCheckpointId(checkpointId))
}
