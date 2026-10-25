import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createListTool } from '../../electron/chat/shared/tools/listTool'

async function listMemory(workspaceRootPath: string, target: string) {
  const definition = createListTool({ workspaceRootPath })
  return definition.execute!({ path: target }, {
    context: {}, messages: [], toolCallId: 'memory-list-test',
  })
}

test('missing memory directories return empty memory results without creating files', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'memory-list-missing-'))
  try {
    for (const [target, message] of [
      ['.tidecode/memory', 'No workspace memory yet.'],
      ['.tidecode/memory/details', 'No memory details yet.'],
    ]) {
      const result = await listMemory(workspaceRootPath, target)
      assert.equal(result.status, 'success')
      assert.equal(result.body, message)
      assert.equal(result.semantics?.memory_state, 'empty')
      assert.equal(result.semantics?.has_more, false)
    }
    await assert.rejects(fs.stat(path.join(workspaceRootPath, '.tidecode')), { code: 'ENOENT' })
  } finally {
    await fs.rm(workspaceRootPath, { recursive: true, force: true })
  }
})

test('existing empty memory directories return the same messages, populated directories return entries', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'memory-list-existing-'))
  try {
    const details = path.join(workspaceRootPath, '.tidecode', 'memory', 'details')
    await fs.mkdir(details, { recursive: true })
    const empty = await listMemory(workspaceRootPath, '.tidecode/memory/details')
    assert.equal(empty.body, 'No memory details yet.')
    await fs.writeFile(path.join(details, 'notes.md'), '# Notes\n')
    const populated = await listMemory(workspaceRootPath, '.tidecode/memory/details')
    assert.equal(populated.status, 'success')
    assert.match(populated.body ?? '', /notes\.md/u)
    assert.notEqual(populated.semantics?.memory_state, 'empty')
    const root = await listMemory(workspaceRootPath, '.tidecode/memory')
    assert.match(root.body ?? '', /details/u)
  } finally {
    await fs.rm(workspaceRootPath, { recursive: true, force: true })
  }
})

test('unrelated missing paths remain errors', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'memory-list-unrelated-'))
  try {
    const result = await listMemory(workspaceRootPath, '.tidecode/other')
    assert.equal(result.status, 'error')
    assert.match(result.body ?? '', /Path not found/u)
  } finally {
    await fs.rm(workspaceRootPath, { recursive: true, force: true })
  }
})
