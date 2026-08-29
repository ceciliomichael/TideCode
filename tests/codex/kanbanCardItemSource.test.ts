import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import test from 'node:test'

test('Kanban card footer vertically centers owner, subtask, and acceptance-criteria metadata', async () => {
  const source = await fs.readFile(
    new URL('../../src/components/kanban/KanbanCardItem.tsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /text-\[11px\] leading-none text-muted-foreground/u)
  assert.equal(source.match(/inline-flex h-4 min-w-0 items-center gap-1 leading-none/gu)?.length, 1)
  assert.equal(source.match(/inline-flex h-4 items-center gap-1 leading-none/gu)?.length, 2)
  assert.match(source, /<CircleUserRound size=\{13\} className="shrink-0" \/>/u)
  assert.match(source, /<ListTodo size=\{13\} className="shrink-0" \/>/u)
  assert.match(source, /<CheckSquare2 size=\{13\} className="shrink-0" \/>/u)
})
