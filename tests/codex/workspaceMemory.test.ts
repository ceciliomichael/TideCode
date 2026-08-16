import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AgentToolExecutionResult } from '../../electron/chat/shared/toolTypes'
import { createNativeAgentTools } from '../../electron/chat/shared/tools'
import {
  editMemoryEntry,
  forgetMemoryEntry,
  writeMemoryEntry,
} from '../../electron/memory/service'

interface ExecutableTool {
  execute: (input: Record<string, unknown>) => Promise<AgentToolExecutionResult>
}

async function readWorkspaceFile(workspaceRootPath: string, relativePath: string) {
  return fs.readFile(path.join(workspaceRootPath, ...relativePath.split('/')), 'utf8')
}

test('workspace memory maintains a generated index and replaces stale entries', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-memory-'))

  try {
    const created = await writeMemoryEntry({
      content: 'The runtime uses canonical replay.',
      path: '.tidecode/memory/folders/architecture/runtime.md',
      title: 'Runtime architecture',
      workspaceRootPath,
    })
    assert.equal(created.operation, 'created')
    assert.equal(created.path, '.tidecode/memory/folders/architecture/runtime.md')

    const firstIndex = await readWorkspaceFile(workspaceRootPath, '.tidecode/memory/MEMORY.md')
    assert.match(firstIndex, /\[Runtime architecture\]\(folders\/architecture\/runtime\.md\)/u)

    const updated = await writeMemoryEntry({
      content: '# Runtime architecture\n\nCanonical replay is authoritative; legacy replay is fallback only.',
      path: 'folders/architecture/runtime.md',
      workspaceRootPath,
    })
    assert.equal(updated.operation, 'updated')

    const document = await readWorkspaceFile(workspaceRootPath, '.tidecode/memory/folders/architecture/runtime.md')
    assert.doesNotMatch(document, /The runtime uses canonical replay/u)
    assert.match(document, /legacy replay is fallback only/u)

    const edited = await editMemoryEntry({
      newText: 'legacy replay is used only for migration.',
      oldText: 'legacy replay is fallback only.',
      path: 'folders/architecture/runtime.md',
      workspaceRootPath,
    })
    assert.equal(edited.operation, 'updated')
    assert.match(edited.content, /legacy replay is used only for migration/u)

    const forgotten = await forgetMemoryEntry({
      path: 'folders/architecture/runtime.md',
      workspaceRootPath,
    })
    assert.equal(forgotten.operation, 'deleted')
    assert.doesNotMatch(await readWorkspaceFile(workspaceRootPath, '.tidecode/memory/MEMORY.md'), /runtime\.md/u)
    await assert.rejects(
      fs.access(path.join(workspaceRootPath, '.tidecode/memory/folders/architecture')),
      { code: 'ENOENT' },
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('workspace memory preserves non-empty folders after forgetting one entry', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-memory-folder-'))

  try {
    await writeMemoryEntry({
      content: 'Keep this entry.',
      path: 'folders/architecture/keep.md',
      workspaceRootPath,
    })
    await writeMemoryEntry({
      content: 'Delete this entry.',
      path: 'folders/architecture/delete.md',
      workspaceRootPath,
    })

    await forgetMemoryEntry({
      path: 'folders/architecture/delete.md',
      workspaceRootPath,
    })

    await assert.doesNotReject(
      fs.access(path.join(workspaceRootPath, '.tidecode/memory/folders/architecture')),
    )
    assert.match(
      await readWorkspaceFile(workspaceRootPath, '.tidecode/memory/folders/architecture/keep.md'),
      /Keep this entry/u,
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('workspace memory accepts absolute paths inside the workspace', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-memory-absolute-'))
  const absoluteMemoryPath = path.join(
    workspaceRootPath,
    '.tidecode',
    'memory',
    'folders',
    'architecture',
    'absolute.md',
  )

  try {
    const created = await writeMemoryEntry({
      content: 'Absolute paths resolve within the selected workspace.',
      path: absoluteMemoryPath,
      workspaceRootPath,
    })
    assert.equal(created.operation, 'created')
    assert.equal(created.path, '.tidecode/memory/folders/architecture/absolute.md')
    assert.match(await fs.readFile(absoluteMemoryPath, 'utf8'), /Absolute paths resolve/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('workspace memory rejects paths outside managed folders', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-memory-path-'))

  try {
    await assert.rejects(
      writeMemoryEntry({
        content: 'Do not write this.',
        path: '../outside.md',
        workspaceRootPath,
      }),
      /must be stored under/u,
    )
    await assert.rejects(
      writeMemoryEntry({
        content: 'Do not replace the index.',
        path: '.tidecode/memory/MEMORY.md',
        workspaceRootPath,
      }),
      /must be stored under/u,
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('normal read owns workspace memory reads and memory tool is mutation-only', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-memory-tools-'))

  try {
    const tools = await createNativeAgentTools({ workspaceRootPath }, { chatMode: 'plan' })
    const memoryTool = tools.memory as unknown as ExecutableTool
    const readTool = tools.read as unknown as ExecutableTool
    assert.ok(memoryTool)
    assert.ok(readTool)

    const emptyIndex = await readTool.execute({ path: '.tidecode/memory/MEMORY.md' })
    assert.equal(emptyIndex.status, 'success')
    assert.equal(emptyIndex.body, 'No workspace memory yet.')
    await assert.rejects(fs.access(path.join(workspaceRootPath, '.tidecode')), { code: 'ENOENT' })

    const missingEntry = await readTool.execute({ path: '.tidecode/memory/folders/preferences/missing.md' })
    assert.equal(missingEntry.status, 'success')
    assert.match(missingEntry.body ?? '', /Workspace memory entry does not exist/u)
    assert.match(missingEntry.body ?? '', /\.tidecode\/memory\/MEMORY\.md/u)

    const invalidPath = await readTool.execute({ path: '.tidecode/memory/folders/preferences' })
    assert.equal(invalidPath.status, 'success')
    assert.match(invalidPath.body ?? '', /Invalid workspace memory path/u)

    const removedReadIndex = await memoryTool.execute({ action: 'read_index' })
    assert.equal(removedReadIndex.status, 'error')
    await assert.rejects(fs.access(path.join(workspaceRootPath, '.tidecode')), { code: 'ENOENT' })

    const memoryResult = await memoryTool.execute({
      action: 'write',
      content: '# Prompt preference\n\nKeep system instructions compact.',
      path: '.tidecode/memory/folders/preferences/prompts.md',
    })
    assert.equal(memoryResult.status, 'success')

    const indexResult = await readTool.execute({ path: '.tidecode/memory/MEMORY.md' })
    assert.equal(indexResult.status, 'success')
    assert.match(indexResult.body ?? '', /folders\/preferences\/prompts\.md/u)

    const entryResult = await readTool.execute({ path: '.tidecode/memory/folders/preferences/prompts.md' })
    assert.equal(entryResult.status, 'success')
    assert.match(entryResult.body ?? '', /Keep system instructions compact/u)

    const removedRead = await memoryTool.execute({
      action: 'read',
      path: '.tidecode/memory/folders/preferences/prompts.md',
    })
    assert.equal(removedRead.status, 'error')
    assert.match(
      await readWorkspaceFile(workspaceRootPath, '.tidecode/memory/folders/preferences/prompts.md'),
      /Keep system instructions compact/u,
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
