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
  readWorkspaceDurableMemory,
  readWorkspaceMemoryIndex,
  refreshWorkspaceMemoryIndex,
  updateWorkspaceDurableMemory,
  writeMemoryEntry,
} from '../../electron/memory/service'
import { applyWorkspaceMemoryContext } from '../../electron/chat/shared/memory/runtimeContext'

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
      path: '.tidecode/memory/details/architecture/runtime.md',
      title: 'Runtime architecture',
      workspaceRootPath,
    })
    assert.equal(created.operation, 'created')
    assert.equal(created.path, '.tidecode/memory/details/architecture/runtime.md')

    const firstIndex = await readWorkspaceFile(workspaceRootPath, '.tidecode/memory/MEMORY.md')
    assert.match(firstIndex, /\[Runtime architecture\]\(details\/architecture\/runtime\.md\)/u)

    const updated = await writeMemoryEntry({
      content: '# Runtime architecture\n\nCanonical replay is authoritative; legacy replay is fallback only.',
      path: 'details/architecture/runtime.md',
      workspaceRootPath,
    })
    assert.equal(updated.operation, 'updated')

    const document = await readWorkspaceFile(workspaceRootPath, '.tidecode/memory/details/architecture/runtime.md')
    assert.doesNotMatch(document, /The runtime uses canonical replay/u)
    assert.match(document, /legacy replay is fallback only/u)

    const edited = await editMemoryEntry({
      newText: 'legacy replay is used only for migration.',
      oldText: 'legacy replay is fallback only.',
      path: 'details/architecture/runtime.md',
      workspaceRootPath,
    })
    assert.equal(edited.operation, 'updated')
    assert.match(edited.content, /legacy replay is used only for migration/u)

    const forgotten = await forgetMemoryEntry({
      path: 'details/architecture/runtime.md',
      workspaceRootPath,
    })
    assert.equal(forgotten.operation, 'deleted')
    assert.doesNotMatch(await readWorkspaceFile(workspaceRootPath, '.tidecode/memory/MEMORY.md'), /runtime\.md/u)
    await assert.rejects(
      fs.access(path.join(workspaceRootPath, '.tidecode/memory/details/architecture')),
      { code: 'ENOENT' },
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('workspace memory preserves non-empty detail folders after forgetting one entry', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-memory-folder-'))

  try {
    await writeMemoryEntry({
      content: 'Keep this entry.',
      path: 'details/architecture/keep.md',
      workspaceRootPath,
    })
    await writeMemoryEntry({
      content: 'Delete this entry.',
      path: 'details/architecture/delete.md',
      workspaceRootPath,
    })

    await forgetMemoryEntry({
      path: 'details/architecture/delete.md',
      workspaceRootPath,
    })

    await assert.doesNotReject(
      fs.access(path.join(workspaceRootPath, '.tidecode/memory/details/architecture')),
    )
    assert.match(
      await readWorkspaceFile(workspaceRootPath, '.tidecode/memory/details/architecture/keep.md'),
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
    'details',
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
    assert.equal(created.path, '.tidecode/memory/details/architecture/absolute.md')
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

test('normal read owns workspace memory reads and agents expose no memory tool', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-memory-tools-'))

  try {
    const tools = await createNativeAgentTools({ workspaceRootPath }, { chatMode: 'plan' })
    const readTool = tools.read as unknown as ExecutableTool
    assert.ok(!('memory' in tools))
    assert.ok(readTool)

    const emptyIndex = await readTool.execute({ path: '.tidecode/memory/MEMORY.md' })
    assert.equal(emptyIndex.status, 'success')
    assert.equal(emptyIndex.body, 'No workspace memory yet.')
    await assert.rejects(fs.access(path.join(workspaceRootPath, '.tidecode')), { code: 'ENOENT' })

    const missingEntry = await readTool.execute({ path: '.tidecode/memory/details/preferences/missing.md' })
    assert.equal(missingEntry.status, 'success')
    assert.match(missingEntry.body ?? '', /Workspace memory entry does not exist/u)
    assert.match(missingEntry.body ?? '', /\.tidecode\/memory\/MEMORY\.md/u)

    const invalidPath = await readTool.execute({ path: '.tidecode/memory/details/preferences' })
    assert.equal(invalidPath.status, 'success')
    assert.match(invalidPath.body ?? '', /Invalid workspace memory path/u)

    await writeMemoryEntry({
      content: '# Prompt preference\n\nKeep system instructions compact.',
      path: '.tidecode/memory/details/preferences/prompts.md',
      workspaceRootPath,
    })

    const indexResult = await readTool.execute({ path: '.tidecode/memory/MEMORY.md' })
    assert.equal(indexResult.status, 'success')
    assert.match(indexResult.body ?? '', /details\/preferences\/prompts\.md/u)

    const entryResult = await readTool.execute({ path: '.tidecode/memory/details/preferences/prompts.md' })
    assert.equal(entryResult.status, 'success')
    assert.match(entryResult.body ?? '', /Keep system instructions compact/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('workspace durable memory is stored once per workspace and injected into new chat context', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-durable-memory-'))

  try {
    await updateWorkspaceDurableMemory(workspaceRootPath, async () => [
      '## Decisions',
      '- Keep Code Mode tool-only.',
    ].join('\n'))

    const durable = await readWorkspaceDurableMemory(workspaceRootPath)
    assert.ok(durable)
    assert.match(durable.content, /Keep Code Mode tool-only/u)

    const projected = await applyWorkspaceMemoryContext(
      [{ role: 'user', content: 'Start a new chat.' }],
      workspaceRootPath,
      false,
    )
    const text = String(projected[0]?.content ?? '')
    assert.match(text, /workspace_durable_memory/u)
    assert.match(text, /Keep Code Mode tool-only/u)
    assert.match(text, /Workspace memory is disabled/u)
    assert.doesNotMatch(text, /optional workspace memory/iu)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('enabled workspace memory injects MEMORY.md as an index and points to details', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-optional-memory-'))

  try {
    await writeMemoryEntry({
      content: '# Workflow\n\nKeep feature branches after merge.',
      path: 'details/workflow.md',
      workspaceRootPath,
    })

test('legacy folders memory migrates to details without losing conflicting entries', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-memory-legacy-'))
  const legacyDirectory = path.join(workspaceRootPath, '.tidecode', 'memory', 'folders', 'architecture')
  const detailsDirectory = path.join(workspaceRootPath, '.tidecode', 'memory', 'details', 'architecture')

  try {
    await fs.mkdir(legacyDirectory, { recursive: true })
    await fs.mkdir(detailsDirectory, { recursive: true })
    await fs.writeFile(path.join(legacyDirectory, 'runtime.md'), '# Legacy runtime\n\nLegacy fact.\n', 'utf8')
    await fs.writeFile(path.join(legacyDirectory, 'conflict.md'), '# Legacy conflict\n\nOld fact.\n', 'utf8')
    await fs.writeFile(path.join(detailsDirectory, 'conflict.md'), '# Current conflict\n\nNew fact.\n', 'utf8')

    const index = await refreshWorkspaceMemoryIndex(workspaceRootPath)
    assert.ok(index)
    assert.match(index.content, /details\/architecture\/runtime\.md/u)
    assert.match(index.content, /details\/architecture\/conflict\.legacy\.md/u)
    assert.match(await fs.readFile(path.join(detailsDirectory, 'runtime.md'), 'utf8'), /Legacy fact/u)
    assert.match(await fs.readFile(path.join(detailsDirectory, 'conflict.legacy.md'), 'utf8'), /Old fact/u)
    await assert.rejects(fs.access(path.join(workspaceRootPath, '.tidecode', 'memory', 'folders')), { code: 'ENOENT' })
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
    const index = await readWorkspaceMemoryIndex(workspaceRootPath)
    assert.ok(index)
    assert.match(index.content, /\[Workflow\]\(details\/workflow\.md\)/u)

    const enabled = await applyWorkspaceMemoryContext(
      [{ role: 'user', content: 'Continue.' }],
      workspaceRootPath,
      true,
    )
    const enabledText = String(enabled[0]?.content ?? '')
    assert.match(enabledText, /Workspace memory is enabled and active for this workspace/u)
    assert.match(enabledText, /even if no memory files exist yet/u)
    assert.doesNotMatch(enabledText, /optional workspace memory/iu)
    assert.match(enabledText, /\.tidecode\/memory\/MEMORY\.md is the compact index/u)
    assert.match(enabledText, /\.tidecode\/memory\/details\/\*\.md contains focused detailed memory entries/u)
    assert.match(enabledText, /- \[Topic\]\(details\/topic\.md\) - Short description\./u)
    assert.match(enabledText, /create the relevant detail file and create MEMORY\.md with its first index link/u)
    assert.match(enabledText, /details\/workflow\.md/u)

    const disabled = await applyWorkspaceMemoryContext(enabled, workspaceRootPath, false)
    const disabledText = String(disabled[0]?.content ?? '')
    assert.match(disabledText, /Workspace memory is disabled/u)
    assert.doesNotMatch(disabledText, /details\/workflow\.md/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('enabled workspace memory teaches bootstrap format even before MEMORY.md exists', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-memory-bootstrap-'))

  try {
    const projected = await applyWorkspaceMemoryContext(
      [{ role: 'user', content: 'Start fresh.' }],
      workspaceRootPath,
      true,
    )
    const text = String(projected[0]?.content ?? '')
    assert.match(text, /Workspace memory is enabled and active for this workspace/u)
    assert.match(text, /No MEMORY\.md index currently exists\. Workspace memory is still enabled/u)
    assert.match(text, /create the first indexed detail entry/u)
    assert.doesNotMatch(text, /optional workspace memory/iu)
    await assert.rejects(fs.access(path.join(workspaceRootPath, '.tidecode', 'memory', 'MEMORY.md')), { code: 'ENOENT' })
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
