import type { KanbanColumnDefinition } from './kanbanTypes'

export const KANBAN_COLUMNS: readonly KanbanColumnDefinition[] = [
  {
    description: 'Ideas, follow-ups, and work that has not started yet.',
    id: 'backlog',
    title: 'Backlog',
  },
  {
    description: 'Active work currently being handled.',
    id: 'in-progress',
    title: 'In Progress',
  },
  {
    description: 'Items awaiting review, clarification, access, or another dependency.',
    id: 'for-review',
    title: 'For Review',
  },
  {
    description: 'Completed work and resolved tasks.',
    id: 'done',
    title: 'Done',
  },
] as const
