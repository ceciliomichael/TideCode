import type { KanbanBoardData, KanbanCard, KanbanColumnId } from './kanbanTypes'

const STORAGE_PREFIX = 'echosphere-kanban-board:'
const COLUMN_IDS = new Set<KanbanColumnId>(['backlog', 'in-progress', 'blocked', 'done'])

function getStorageKey(conversationId: string) {
  return `${STORAGE_PREFIX}${conversationId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isKanbanColumnId(value: unknown): value is KanbanColumnId {
  return typeof value === 'string' && COLUMN_IDS.has(value as KanbanColumnId)
}

function parseKanbanCard(value: unknown): KanbanCard | null {
  if (!isRecord(value)) {
    return null
  }

  if (
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.description !== 'string' ||
    typeof value.createdAt !== 'number' ||
    typeof value.updatedAt !== 'number' ||
    !isKanbanColumnId(value.columnId)
  ) {
    return null
  }

  return {
    columnId: value.columnId,
    createdAt: value.createdAt,
    description: value.description,
    id: value.id,
    sourceMessageId: typeof value.sourceMessageId === 'string' ? value.sourceMessageId : undefined,
    title: value.title,
    updatedAt: value.updatedAt,
  }
}

function parseKanbanBoardData(value: unknown): KanbanBoardData {
  if (!isRecord(value) || !Array.isArray(value.cards)) {
    return { cards: [] }
  }

  return {
    cards: value.cards.map(parseKanbanCard).filter((card): card is KanbanCard => card !== null),
  }
}

export function loadKanbanBoardData(conversationId: string | null): KanbanBoardData {
  if (!conversationId || typeof window === 'undefined') {
    return { cards: [] }
  }

  try {
    const storedValue = window.localStorage.getItem(getStorageKey(conversationId))
    if (!storedValue) {
      return { cards: [] }
    }

    return parseKanbanBoardData(JSON.parse(storedValue))
  } catch (error) {
    console.error('Failed to load Kanban board data', error)
    return { cards: [] }
  }
}

export function saveKanbanBoardData(conversationId: string | null, boardData: KanbanBoardData) {
  if (!conversationId || typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(getStorageKey(conversationId), JSON.stringify(boardData))
  } catch (error) {
    console.error('Failed to save Kanban board data', error)
  }
}
