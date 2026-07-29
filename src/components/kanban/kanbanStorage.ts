import type { KanbanBoardData } from '../../lib/kanban'

export function loadLegacyKanbanBoardData(workspacePath: string | null): KanbanBoardData {
  const normalizedWorkspacePath = workspacePath?.trim()
  if (!normalizedWorkspacePath || typeof window === 'undefined') {
    return { cards: [], revision: 0 }
  }

  return { cards: [], revision: 0 }
}
