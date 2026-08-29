import { KANBAN_COLUMNS } from './kanbanDefaults'
import {
  getKanbanIssueTypeLabel,
  getKanbanOwnerLabel,
  getKanbanPriorityOption,
} from './kanbanPresentation'
import type { KanbanCard } from './kanbanTypes'

function getStatusLabel(card: KanbanCard) {
  return KANBAN_COLUMNS.find((column) => column.id === card.columnId)?.title ?? card.columnId
}

function formatAcceptanceCriteria(card: KanbanCard) {
  return card.acceptanceCriteria
    .map((criterion) => `[${criterion.completed ? 'x' : ' '}] ${criterion.text}`)
    .join(' | ')
}

function escapeCsvCell(value: string) {
  return `"${value.replace(/"/gu, '""')}"`
}

function toCsvRow(values: readonly string[]) {
  return values.map(escapeCsvCell).join(',')
}

export function buildKanbanCsvExport(card: KanbanCard, subtasks: readonly KanbanCard[]) {
  const rows = [card, ...subtasks]
  return [
    toCsvRow([
      'Kind',
      'Title',
      'Parent Task',
      'Status',
      'Priority',
      'Type',
      'Owner',
      'Labels',
      'Context',
      'Acceptance Criteria',
    ]),
    ...rows.map((item) =>
      toCsvRow([
        item.id === card.id ? (card.parentCardId ? 'Subtask' : 'Task') : 'Subtask',
        item.title,
        item.id === card.id ? '' : card.title,
        getStatusLabel(item),
        getKanbanPriorityOption(item.priority).label,
        getKanbanIssueTypeLabel(item.issueType),
        getKanbanOwnerLabel(item.assignee),
        item.labels.join(', '),
        item.description,
        formatAcceptanceCriteria(item),
      ]),
    ),
  ].join('\n')
}

function appendCardMetadata(lines: string[], card: KanbanCard) {
  lines.push(`- **Status:** ${getStatusLabel(card)}`)
  lines.push(`- **Priority:** ${getKanbanPriorityOption(card.priority).label}`)
  lines.push(`- **Type:** ${getKanbanIssueTypeLabel(card.issueType)}`)
  lines.push(`- **Owner:** ${getKanbanOwnerLabel(card.assignee) || 'Unassigned'}`)
  lines.push(`- **Labels:** ${card.labels.length > 0 ? card.labels.join(', ') : 'None'}`)
}

function appendAcceptanceCriteria(lines: string[], card: KanbanCard, headingLevel = '##') {
  if (card.acceptanceCriteria.length === 0) {
    return
  }
  lines.push('', `${headingLevel} Acceptance criteria`)
  for (const criterion of card.acceptanceCriteria) {
    lines.push(`- [${criterion.completed ? 'x' : ' '}] ${criterion.text}`)
  }
}

export function buildKanbanMarkdownExport(card: KanbanCard, subtasks: readonly KanbanCard[]) {
  const lines: string[] = [`# ${card.title}`, '']
  appendCardMetadata(lines, card)

  if (card.description.trim()) {
    lines.push('', '## Context', '', card.description.trim())
  }
  appendAcceptanceCriteria(lines, card)

  if (subtasks.length > 0) {
    lines.push('', '## Subtasks')
    for (const subtask of subtasks) {
      lines.push('', `### ${subtask.title}`)
      appendCardMetadata(lines, subtask)
      if (subtask.description.trim()) {
        lines.push('', subtask.description.trim())
      }
      appendAcceptanceCriteria(lines, subtask, '####')
    }
  }

  return `${lines.join('\n').trim()}\n`
}

export function buildKanbanExportFilename(title: string, extension: 'csv' | 'md') {
  const baseName = title
    .trim()
    .replace(/[<>:"/\\|?*]+/gu, '-')
    .replace(/\s+/gu, ' ')
    .replace(/[. ]+$/gu, '')
    .slice(0, 80)
    .trim()
  return `${baseName || 'kanban-task'}.${extension}`
}
