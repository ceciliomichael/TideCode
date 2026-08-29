import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildKanbanCsvExport,
  buildKanbanExportFilename,
  buildKanbanMarkdownExport,
} from '../../src/components/kanban/kanbanExport'
import { getKanbanOwnerLabel } from '../../src/components/kanban/kanbanPresentation'
import type { KanbanCard } from '../../src/components/kanban/kanbanTypes'

function makeCard(overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    acceptanceCriteria: [],
    columnId: 'backlog',
    createdAt: 1,
    description: '',
    id: 'card-1',
    issueType: 'task',
    labels: [],
    position: 0,
    priority: 'none',
    revision: 1,
    title: 'Main task',
    updatedAt: 1,
    ...overrides,
  }
}

test('legacy Person ownership displays as Human while custom owners remain free-form', () => {
  assert.equal(getKanbanOwnerLabel('Person'), 'Human')
  assert.equal(getKanbanOwnerLabel('person'), 'Human')
  assert.equal(getKanbanOwnerLabel('Agent'), 'Agent')
  assert.equal(getKanbanOwnerLabel('Ada'), 'Ada')
})

test('Kanban CSV export includes the main task, direct subtasks, and escaped content', () => {
  const main = makeCard({
    acceptanceCriteria: [{ completed: true, id: 'criterion-1', text: 'Handles "quoted" values' }],
    assignee: 'Person',
    description: 'Line one, with comma\nLine two',
    labels: ['frontend', 'reliability'],
  })
  const child = makeCard({
    assignee: 'Agent',
    columnId: 'done',
    id: 'child-1',
    parentCardId: main.id,
    title: 'Child task',
  })

  const csv = buildKanbanCsvExport(main, [child])

  assert.match(csv, /"Owner"/u)
  assert.match(csv, /"Human"/u)
  assert.match(csv, /"Agent"/u)
  assert.match(csv, /"Child task"/u)
  assert.match(csv, /"Line one, with comma\nLine two"/u)
  assert.match(csv, /Handles ""quoted"" values/u)
})

test('Kanban Markdown export includes metadata, criteria, and direct subtasks', () => {
  const main = makeCard({
    acceptanceCriteria: [{ completed: false, id: 'criterion-1', text: 'Ship regression test' }],
    assignee: 'Human',
    description: 'Keep the current behavior stable.',
    priority: 'high',
  })
  const child = makeCard({
    assignee: 'Agent',
    columnId: 'in-progress',
    id: 'child-1',
    parentCardId: main.id,
    title: 'Implement exporter',
  })

  const markdown = buildKanbanMarkdownExport(main, [child])

  assert.match(markdown, /^# Main task/mu)
  assert.match(markdown, /\*\*Owner:\*\* Human/u)
  assert.match(markdown, /- \[ \] Ship regression test/u)
  assert.match(markdown, /## Subtasks/u)
  assert.match(markdown, /### Implement exporter/u)
  assert.match(markdown, /\*\*Owner:\*\* Agent/u)
})

test('Kanban export filenames remove invalid filesystem characters', () => {
  assert.equal(buildKanbanExportFilename('Fix: chat / export?', 'csv'), 'Fix- chat - export-.csv')
  assert.equal(buildKanbanExportFilename('   ', 'md'), 'kanban-task.md')
})
