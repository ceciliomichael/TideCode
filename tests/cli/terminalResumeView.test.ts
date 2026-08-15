import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResumeConversationItem } from '../../electron/cli/resumeCatalog'
import { getResumeSelectionItems } from '../../electron/cli/interactiveResumeSelect'
import { colors } from '../../electron/cli/renderer'
import { buildTerminalResumeLines, formatResumeRelativeTime } from '../../electron/cli/terminalResumeView'
import { stripAnsi, visibleWidth } from '../../electron/cli/terminalText'

const now = 1_000_000_000
const items: ResumeConversationItem[] = [
  {
    id: 'project-one-new',
    title: 'Fix the terminal composer',
    preview: 'Paste image from the clipboard',
    createdAt: now - 90_000,
    updatedAt: now - 10_000,
    workspacePath: 'C:/projects/project1',
    projectLabel: 'project1',
    isArchived: false,
  },
  {
    id: 'project-one-old',
    title: 'Review the CLI history',
    preview: 'Search previous sessions',
    createdAt: now - 500_000,
    updatedAt: now - 300_000,
    workspacePath: 'C:/projects/project1',
    projectLabel: 'project1',
    isArchived: true,
  },
  {
    id: 'project-two',
    title: 'Other project session',
    preview: 'Different workspace',
    createdAt: now - 700_000,
    updatedAt: now - 20_000,
    workspacePath: 'C:/projects/project2',
    projectLabel: 'project2',
    isArchived: false,
  },
]

test('resume selector defaults to the current project and supports search and sort', () => {
  assert.deepEqual(
    getResumeSelectionItems(items, 'C:/projects/project1', 'cwd', '', 'updated').map((item) => item.id),
    ['project-one-new'],
  )
  assert.deepEqual(
    getResumeSelectionItems(items, 'C:/projects/project1', 'cwd', 'clipboard', 'updated').map((item) => item.id),
    ['project-one-new'],
  )
  assert.deepEqual(
    getResumeSelectionItems(items, 'C:/projects/project1', 'all', '', 'created').map((item) => item.id),
    ['project-one-new', 'project-two'],
  )
  assert.deepEqual(
    getResumeSelectionItems(items, 'C:/projects/project1', 'all', '', 'created', 'archived').map((item) => item.id),
    ['project-one-old'],
  )
})

test('resume selector renders a full-width compact workspace list', () => {
  const lines = buildTerminalResumeLines({
    items: items,
    projectLabel: 'project1',
    query: '',
    selectedIndex: 0,
    pageSize: 2,
    filterScope: 'cwd',
    sortMode: 'updated',
    page: 'active',
  }, 96)

  assert.equal(lines.every((line) => visibleWidth(line) === 96), true)
  assert.equal((stripAnsi(lines[0] ?? '')[0] ?? ''), ' ')
  assert.match(stripAnsi(lines[0] ?? ''), /Type to search/)
  assert.match(stripAnsi(lines[0] ?? ''), /Filter:/)
  assert.ok(lines.some((line) => stripAnsi(line).includes('Fix the terminal composer')))
  assert.equal(lines.some((line) => stripAnsi(line).includes('Review the CLI history')), false)
  assert.match(stripAnsi(lines.at(-1) ?? ''), /1 \/ 2 {2}0%/)

  const selectedRow = lines.find((line) => stripAnsi(line).includes('Fix the terminal composer')) ?? ''
  assert.equal((stripAnsi(selectedRow)[0] ?? ''), ' ')
  assert.ok(selectedRow.includes(`${colors.bgContainer}${colors.accent}›${colors.reset}${colors.bgContainer}`))
  assert.equal(selectedRow.endsWith(colors.reset), true)

  const searchingLines = buildTerminalResumeLines({
    items,
    projectLabel: 'project1',
    query: 'add',
    selectedIndex: 0,
    pageSize: 2,
    filterScope: 'cwd',
    sortMode: 'updated',
    page: 'active',
  }, 96)
  assert.match(stripAnsi(searchingLines[0] ?? ''), /^ Search: add/u)

  const archivedLines = buildTerminalResumeLines({
    items,
    projectLabel: 'project1',
    query: '',
    selectedIndex: 0,
    pageSize: 2,
    filterScope: 'cwd',
    sortMode: 'updated',
    page: 'archived',
  }, 96)
  assert.ok(archivedLines.some((line) => stripAnsi(line).includes('Review the CLI history')))
})

test('resume relative time stays compact for terminal rows', () => {
  assert.equal(formatResumeRelativeTime(now - 52_000, now), '52s ago')
  assert.equal(formatResumeRelativeTime(now - 8 * 60 * 60_000, now), '8h ago')
  assert.equal(formatResumeRelativeTime(now - 2 * 24 * 60 * 60_000, now), '2d ago')
})

test('archiving keeps the conversation timestamp used by the relative-time label', () => {
  const activeItem = items[0]
  const archivedItem = { ...activeItem, isArchived: true }

  assert.equal(
    formatResumeRelativeTime(activeItem.updatedAt, now),
    formatResumeRelativeTime(archivedItem.updatedAt, now),
  )
})
