import type { KanbanCard, KanbanIssueType, KanbanPriority } from './kanbanTypes'

export const KANBAN_PRIORITY_OPTIONS: readonly {
  colorClassName: string
  id: KanbanPriority
  label: string
}[] = [
  { colorClassName: 'bg-subtle-foreground', id: 'none', label: 'No priority' },
  { colorClassName: 'bg-sky-500', id: 'low', label: 'Low' },
  { colorClassName: 'bg-amber-500', id: 'medium', label: 'Medium' },
  { colorClassName: 'bg-orange-500', id: 'high', label: 'High' },
  { colorClassName: 'bg-red-500', id: 'urgent', label: 'Urgent' },
]

export const KANBAN_ISSUE_TYPE_OPTIONS: readonly {
  id: KanbanIssueType
  label: string
}[] = [
  { id: 'task', label: 'Task' },
  { id: 'bug', label: 'Bug' },
  { id: 'idea', label: 'Idea' },
]

export function getKanbanPriorityOption(priority: KanbanPriority) {
  return (
    KANBAN_PRIORITY_OPTIONS.find((option) => option.id === priority) ??
    KANBAN_PRIORITY_OPTIONS[0]
  )
}

export function getKanbanIssueTypeLabel(issueType: KanbanIssueType) {
  return (
    KANBAN_ISSUE_TYPE_OPTIONS.find((option) => option.id === issueType)
      ?.label ?? 'Task'
  )
}

export function getKanbanOwnerLabel(assignee?: string | null) {
  const normalized = assignee?.trim() ?? ''
  if (!normalized) {
    return ''
  }
  return normalized.toLocaleLowerCase() === 'person' ? 'Human' : normalized
}

export function doesKanbanCardMatchQuery(card: KanbanCard, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) {
    return true
  }

  return [
    card.title,
    card.description,
    getKanbanOwnerLabel(card.assignee),
    card.labels.join(' '),
    card.issueType,
    card.priority,
  ]
    .join(' ')
    .toLocaleLowerCase()
    .includes(normalizedQuery)
}
