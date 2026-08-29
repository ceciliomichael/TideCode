import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import test from 'node:test'

test('opened Kanban task details do not render an X close button', async () => {
  const source = await fs.readFile(
    new URL('../../src/components/kanban/KanbanTaskDetails.tsx', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(source, /aria-label="Close task details"/u)
  assert.doesNotMatch(source, /<X\s/u)
})

test('task detail dropdown selections keep the original background with white text and check', async () => {
  const source = await fs.readFile(
    new URL('../../src/components/kanban/KanbanTaskDetails.tsx', import.meta.url),
    'utf8',
  )

  assert.equal(
    source.match(/selectedOptionClassName="text-white"/gu)?.length,
    3,
  )
  assert.doesNotMatch(source, /selectedOptionClassName="[^"]*bg-action/u)
  assert.equal(
    source.match(/selectedOptionIconClassName="text-white"/gu)?.length,
    3,
  )
})

test('task details hide autosave status copy', async () => {
  const source = await fs.readFile(
    new URL('../../src/components/kanban/KanbanTaskDetails.tsx', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(source, />\s*Saved\s*</u)
  assert.doesNotMatch(source, /Waiting to save/u)
  assert.doesNotMatch(source, /Saving…/u)
})

test('task details header does not render updated timestamp copy', async () => {
  const source = await fs.readFile(
    new URL('../../src/components/kanban/KanbanTaskDetails.tsx', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(source, /Updated \{new Date\(card\.updatedAt\)/u)
})

test('task details show the main task using the same section pattern as subtasks', async () => {
  const source = await fs.readFile(
    new URL('../../src/components/kanban/KanbanTaskDetails.tsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /<header className="relative flex shrink-0 items-center justify-between gap-4/u)
  assert.doesNotMatch(source, /justify-self-center rounded-md/u)
  assert.match(source, /\{isSubtask \? 'Subtask' : 'Task'\}/u)
  assert.match(source, /const parentTask = useMemo/u)
  assert.match(source, /<h3 className="text-sm font-semibold text-foreground">\s*Main task\s*<\/h3>/u)
  assert.match(source, /overflow-hidden rounded-xl border border-border bg-background/u)
  assert.ok(source.includes('<ArrowLeft size={18} />'))
  assert.match(source, /handleOpenCard\(parentTask\.id\)/u)
  assert.match(source, /\{parentTask\.title\}/u)
})

test('task details header exposes CSV and Markdown export actions from a horizontal overflow menu', async () => {
  const source = await fs.readFile(
    new URL('../../src/components/kanban/KanbanTaskDetails.tsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /<MoreHorizontal size=\{17\} \/>/u)
  assert.match(source, /aria-label="Task actions"/u)
  assert.match(source, /Export to CSV/u)
  assert.match(source, /Export to Markdown/u)
  assert.match(source, /buildKanbanCsvExport\(exportCard, exportSubtasks\)/u)
  assert.match(source, /buildKanbanMarkdownExport\(exportCard, exportSubtasks\)/u)
  assert.match(source, /className="space-y-0\.5"/u)
  assert.match(source, /hover:bg-\[var\(--dropdown-option-active-surface\)\]/u)
  assert.match(source, /shadow-soft/u)
  assert.match(source, /document\.body\.appendChild\(anchor\)/u)
  assert.match(source, /anchor\.click\(\)/u)
  assert.match(source, /anchor\.remove\(\)/u)
})

test('task details use Human or Agent owner wording and normalize legacy Person owners', async () => {
  const source = await fs.readFile(
    new URL('../../src/components/kanban/KanbanTaskDetails.tsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /placeholder="Human or Agent"/u)
  assert.match(source, /useState\(getKanbanOwnerLabel\(card\.assignee\)\)/u)
  assert.match(source, /assignee: getKanbanOwnerLabel\(card\.assignee\) \|\| null/u)
})
