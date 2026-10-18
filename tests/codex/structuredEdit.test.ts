import '../configureAppRoot'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { applyStructuredEdits } from '../../electron/chat/shared/structuredEditWorkspace'
import { createAgentToolBundle } from '../../electron/chat/shared/tools'

test('structured edits validate all matches before writing, and support replace_all', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-structured-edit-'))
  const one = path.join(dir, 'one.txt')
  const two = path.join(dir, 'two.txt')
  const resolve = (name: string) => ({ absolutePath: path.join(dir, name), relativePath: name })
  const apply = (changes: Parameters<typeof applyStructuredEdits>[0]) =>
    applyStructuredEdits(changes, resolve, async () => {})
  try {
    await fs.writeFile(one, 'a a\nb')
    await fs.writeFile(two, 'before')
    await assert.rejects(apply([
      { path: 'one.txt', oldText: 'a', newText: 'x' },
      { path: 'two.txt', oldText: 'before', newText: 'after' },
    ]), /2 matches/)
    assert.equal(await fs.readFile(one, 'utf8'), 'a a\nb')
    await assert.rejects(apply([
      { path: 'one.txt', oldText: 'a', newText: 'x', replace_all: true },
      { path: 'two.txt', oldText: 'missing', newText: 'after' },
    ]), /not found/)
    assert.equal(await fs.readFile(one, 'utf8'), 'a a\nb')
    const result = await apply([
      { path: 'one.txt', oldText: 'a', newText: 'x', replace_all: true },
      { path: 'one.txt', oldText: 'x x', newText: 'y' },
      { path: 'two.txt', oldText: 'before', newText: 'after' },
    ])
    assert.deepEqual(result.map((entry) => entry.matches), [3, 1])
    assert.equal(await fs.readFile(one, 'utf8'), 'y\nb')
    assert.equal(await fs.readFile(two, 'utf8'), 'after')
  } finally {
    await fs.rm(dir, { force: true, recursive: true })
  }
})

test('edit API is available in Agent Mode and Plan Mode but Plan Mode cannot edit source', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-edit-modes-'))
  try {
    const file = path.join(dir, 'code.ts')
    await fs.writeFile(file, 'const x = 1\n')
    const agent = await createAgentToolBundle({ workspaceRootPath: dir }, { chatMode: 'agent' })
    const plan = await createAgentToolBundle({ workspaceRootPath: dir }, { chatMode: 'plan' })
    assert.ok(agent.registry.get('edit'))
    assert.ok(plan.registry.get('edit'))
    const edit = plan.nativeTools.edit as { execute: (args: unknown, options: unknown) => Promise<{ status: string; body: string }> }
    const result = await edit.execute({ changes: [{ path: 'code.ts', oldText: '1', newText: '2' }] }, {})
    assert.match(result.body, /active plan/i)
    assert.equal(await fs.readFile(file, 'utf8'), 'const x = 1\n')
    await agent.codeModeExecutor.dispose()
    await plan.codeModeExecutor.dispose()
  } finally {
    await fs.rm(dir, { force: true, recursive: true })
  }
})
