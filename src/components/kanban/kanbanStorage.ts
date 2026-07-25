import { parseKanbanBoardData, type KanbanBoardData } from '../../lib/kanban'

const STORAGE_PREFIX = 'echosphere-kanban-board:'

function getStorageKey(workspacePath: string) {
  return `${STORAGE_PREFIX}${workspacePath}`
}

export function loadLegacyKanbanBoardData(workspacePath: string | null): KanbanBoardData {
  const normalizedWorkspacePath = workspacePath?.trim()
  if (!normalizedWorkspacePath || typeof window === 'undefined') {
    return { cards: [], revision: 0 }
  }

  try {
    const storedValue = window.localStorage.getItem(getStorageKey(normalizedWorkspacePath))
    if (!storedValue) {
      return { cards: [], revision: 0 }
    }

    return parseKanbanBoardData(JSON.parse(storedValue))
  } catch (error) {
    console.error('Failed to load legacy Kanban board data', error)
    return { cards: [], revision: 0 }
  }
}
