import { parseKanbanBoardData, type KanbanBoardData } from '../../lib/kanban'

const STORAGE_PREFIX = 'echosphere-kanban-board:'

function getStorageKey(workspacePath: string) {
  return `${STORAGE_PREFIX}${workspacePath}`
}

export function loadLegacyKanbanBoardData(workspacePath: string | null): KanbanBoardData {
  const normalizedWorkspacePath = workspacePath?.trim()
  if (!normalizedWorkspacePath || typeof window === 'undefined') {
    return { cards: [] }
  }

  try {
    const storedValue = window.localStorage.getItem(getStorageKey(normalizedWorkspacePath))
    if (!storedValue) {
      return { cards: [] }
    }

    return parseKanbanBoardData(JSON.parse(storedValue))
  } catch (error) {
    console.error('Failed to load legacy Kanban board data', error)
    return { cards: [] }
  }
}
