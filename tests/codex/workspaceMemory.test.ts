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
  readMemoryEntry,
  readMemoryIndex,
  writeMemoryEntry,
} from '../../electron/memory/service'

interface ExecutableTool {
  execute: (input: Record<string, unknown>) => Promise<AgentToolExecutionResult>
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

    const firstIndex = await readMemoryIndex(workspaceRootPath)
    assert.match(firstIndex.content, /\[Runtime architecture\]\(folders\/architecture\/runtime\.md\)/u)

    const updated = await writeMemoryEntry({
      content: '# Runtime architecture\n\nCanonical replay is authoritative; legacy replay is fallback only.',
      path: 'folders/architecture/runtime.md',
      workspaceRootPath,
    })
    assert.equal(updated.operation, 'updated')

    const document = await readMemoryEntry({
      path: 'folders/architecture/runtime.md',
      workspaceRootPath,
    })
    assert.doesNotMatch(document.content, /The runtime uses canonical replay/u)
    assert.match(document.content, /legacy replay is fallback only/u)

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
    assert.doesNotMatch((await readMemoryIndex(workspaceRootPath)).content, /runtime\.md/u)
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

test('native memory tool is available in plan mode and operates on its workspace', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-memory-tools-'))

  try {
    const tools = await createNativeAgentTools({ workspaceRootPath }, { chatMode: 'plan' })
    const memoryTool = tools.memory as unknown as ExecutableTool
    assert.ok(memoryTool)

    const memoryResult = await memoryTool.execute({
      action: 'write',
      content: '# Prompt preference\n\nKeep system instructions compact.',
      path: '.tidecode/memory/folders/preferences/prompts.md',
    })
    assert.equal(memoryResult.status, 'success')
    const indexResult = await memoryTool.execute({ action: 'read_index' })
    assert.equal(indexResult.status, 'success')
    assert.match(indexResult.body ?? '', /folders\/preferences\/prompts\.md/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
