import '../configureAppRoot'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parseMemoryDetailMetadata } from '../../electron/memory/detailDocument'
import { createWriteTool } from '../../electron/chat/shared/tools/writeTool'
import { createEditTool } from '../../electron/chat/shared/tools/editTool'
import { createApplyPatchTool } from '../../electron/chat/shared/tools/applyPatchTool'
import { createReadTool } from '../../electron/chat/shared/tools/readTool'
import type { AgentToolExecutionResult } from '../../electron/chat/shared/toolTypes'
import { createAgentToolBundle } from '../../electron/chat/shared/tools'

const createNativeAgentTools = async (...args: Parameters<typeof createAgentToolBundle>) =>
  (await createAgentToolBundle(...args)).nativeTools
import {
  editMemoryEntry,
  forgetMemoryEntry,
  readWorkspaceMemoryIndex,
  refreshWorkspaceMemoryIndex,
  writeMemoryEntry,
} from '../../electron/memory/service'
import { applyConversationMemoryContext, applyWorkspaceMemoryContext } from '../../electron/chat/shared/memory/runtimeContext'

test('per-chat durable context never carries memory from a different chat', () => {
  const chatOne = {
    schema: 'tidecode.conversation_memory/v1' as const,
    markdown: '## Decisions\n- Only chat one knows the secret decision.',
    sourceDigest: 'chat-one',
  }
  const chatTwo = {
    schema: 'tidecode.conversation_memory/v1' as const,
    markdown: '## Decisions\n- Chat two makes a different decision.',
    sourceDigest: 'chat-two',
  }
  const initial = [{ role: 'user' as const, content: 'Continue.' }]
  const first = applyConversationMemoryContext(initial, chatOne)
  const second = applyConversationMemoryContext(first, chatTwo)
  assert.match(String(first[0]?.content), /@chat\/DURABLE\.md/u)
  assert.doesNotMatch(JSON.stringify(first), /Only chat one knows/u)
  assert.doesNotMatch(JSON.stringify(second), /Only chat one knows/u)
  assert.doesNotMatch(JSON.stringify(second), /Chat two makes/u)
  assert.equal(second.filter((message) => String(message.content).startsWith('## Durable conversation memory')).length, 1)
  assert.deepEqual(applyConversationMemoryContext(second, null), initial)
})

interface ExecutableTool {
  execute: (input: Record<string, unknown>) => Promise<AgentToolExecutionResult>
}

test('disabled workspace memory leaves requests unchanged without accessing the workspace', async () => {
  const unavailableWorkspace = path.join(tmpdir(), `tidecode-memory-unavailable-${crypto.randomUUID()}`)
  const messages = [{ role: 'user' as const, content: 'Help with this project.' }]

  assert.deepEqual(await applyWorkspaceMemoryContext(messages, unavailableWorkspace, false), messages)
  assert.deepEqual(await applyWorkspaceMemoryContext([], unavailableWorkspace, false), [])
})

test('disabling workspace memory strips prior injections from multipart messages and preserves attachments', async () => {
  const messages = [{
    role: 'user' as const,
    content: [
      { type: 'text' as const, text: 'Continue.' },
      { type: 'image' as const, image: 'https://example.com/image.png' },
    ],
  }]
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-memory-toggle-'))

  try {
    const enabled = await applyWorkspaceMemoryContext(messages, workspaceRootPath, true)
    assert.notDeepEqual(enabled, messages)
    assert.deepEqual(await applyWorkspaceMemoryContext(enabled, workspaceRootPath, false), messages)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

async function readWorkspaceFile(workspaceRootPath: string, relativePath: string) {
  return fs.readFile(path.join(workspaceRootPath, ...relativePath.split('/')), 'utf8')
}

test('workspace memory maintains a generated index and replaces stale entries', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-memory-'))

  try {
    const created = await writeMemoryEntry({
      content: '---\nname: Runtime architecture\ndescription: How canonical replay works.\n---\n\nThe runtime uses canonical replay.',
      path: '.tidecode/memory/details/architecture/runtime.md',
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

test('preexisting workspace DURABLE.md is never injected into new chats', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-durable-memory-'))

  try {
    const memoryDirectory = path.join(workspaceRootPath, '.tidecode', 'memory')
    await fs.mkdir(memoryDirectory, { recursive: true })
    await fs.writeFile(path.join(memoryDirectory, 'DURABLE.md'), '## Decisions\n- Keep Code Mode tool-only.\n')

    const projected = await applyWorkspaceMemoryContext(
      [{ role: 'user', content: 'Start a new chat.' }],
      workspaceRootPath,
      false,
    )
    const text = String(projected[0]?.content ?? '')
    assert.doesNotMatch(text, /workspace_durable_memory/u)
    assert.doesNotMatch(text, /Keep Code Mode tool-only/u)
    assert.deepEqual(projected, [{ role: 'user', content: 'Start a new chat.' }])
    assert.doesNotMatch(text, /optional workspace memory/iu)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('enabled workspace memory injects only instructions to read the index and details', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-optional-memory-'))

  try {
    await writeMemoryEntry({
      content: '---\nname: Workflow\ndescription: Branch retention rules after merging.\n---\n\nKeep feature branches after merge.',
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
    assert.match(enabledText, /Before working, read \.tidecode\/memory\/MEMORY\.md/u)
    assert.match(enabledText, /name: short-topic-name/u)
    assert.doesNotMatch(enabledText, /details\/workflow\.md|Branch retention rules|Keep feature branches|Current MEMORY\.md index/u)

    const disabled = await applyWorkspaceMemoryContext(enabled, workspaceRootPath, false)
    const disabledText = String(disabled[0]?.content ?? '')
    assert.deepEqual(disabled, [{ role: 'user', content: 'Continue.' }])
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
    assert.match(text, /Workspace memory is enabled/u)
    assert.match(text, /If no index exists, continue normally/u)
    assert.match(text, /Store each topic as a Markdown file under \.tidecode\/memory\/details\//u)
    assert.doesNotMatch(text, /optional workspace memory/iu)
    await assert.rejects(fs.access(path.join(workspaceRootPath, '.tidecode', 'memory', 'MEMORY.md')), { code: 'ENOENT' })
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

function memoryDetail(name: string, description: string, body = 'Confirmed project knowledge.') {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`
}

test('detail metadata supports single-line text and quotes and rejects incomplete or ambiguous metadata', () => {
  assert.deepEqual(parseMemoryDetailMetadata(memoryDetail('workflow', 'pnpm commands: install and test.')), {
    name: 'workflow', description: 'pnpm commands: install and test.',
  })
  assert.deepEqual(parseMemoryDetailMetadata(memoryDetail('"workflow"', "'The project''s pnpm commands.'").replaceAll('\n', '\r\n')), {
    name: 'workflow', description: "The project's pnpm commands.",
  })
  for (const content of [
    '# No metadata',
    '---\nname: workflow\n---\nBody',
    memoryDetail('workflow', ''),
    memoryDetail('workflow', '|\n  multiline'),
    memoryDetail('workflow', '"unclosed'),
    memoryDetail('workflow', '"escaped\\nnewline"'),
    memoryDetail('workflow', 'Commands.').replace('name: workflow', 'name: workflow\nname: duplicate'),
  ]) {
    assert.equal(parseMemoryDetailMetadata(content), null, content)
  }
})

test('normal file tools synchronize memory before returning and preserve the index after rejected edits', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-memory-sync-'))
  const context = { workspaceRootPath, enabledSkills: [], terminalExecutionMode: 'sandbox' as const }
  const write = createWriteTool(context) as unknown as ExecutableTool
  const edit = createEditTool(context) as unknown as ExecutableTool
  const patch = createApplyPatchTool(context) as unknown as ExecutableTool
  const indexPath = '.tidecode/memory/MEMORY.md'
  const detailPath = '.tidecode/memory/details/workflow.md'
  const patchText = (body: string) => `*** Begin Patch\n${body}\n*** End Patch`

  try {
    assert.equal((await write.execute({ path: detailPath, content: memoryDetail('workflow', 'pnpm install and test commands.') })).status, 'success')
    const initialIndex = await readWorkspaceFile(workspaceRootPath, indexPath)
    assert.match(initialIndex, /- \[workflow\]\(details\/workflow\.md\) - pnpm install and test commands\./u)
    assert.doesNotMatch(initialIndex, /updated \d{4}|Confirmed project knowledge/u)

    assert.equal((await edit.execute({ changes: [{ path: detailPath, oldText: 'pnpm install and test commands.', newText: 'pnpm install, test, and typecheck commands.' }] })).status, 'success')
    const updatedIndex = await readWorkspaceFile(workspaceRootPath, indexPath)
    assert.match(updatedIndex, /pnpm install, test, and typecheck commands/u)

    assert.equal((await edit.execute({ changes: [{ path: detailPath, oldText: 'Missing text', newText: 'No change' }] })).status, 'error')
    assert.equal(await readWorkspaceFile(workspaceRootPath, indexPath), updatedIndex)

    assert.equal((await patch.execute({ patch: patchText(`*** Update File: ${detailPath}\n@@\n-Missing patch text\n+No change`) })).status, 'error')
    assert.equal(await readWorkspaceFile(workspaceRootPath, indexPath), updatedIndex)

    const movedPath = '.tidecode/memory/details/development/workflow.md'
    assert.equal((await patch.execute({ patch: patchText(`*** Update File: ${detailPath}\n*** Move to: ${movedPath}\n@@\n-name: workflow\n+name: development-workflow`) })).status, 'success')
    const movedIndex = await readWorkspaceFile(workspaceRootPath, indexPath)
    assert.match(movedIndex, /\[development-workflow\]\(details\/development\/workflow\.md\)/u)
    assert.doesNotMatch(movedIndex, /\(details\/workflow\.md\)/u)

    assert.equal((await patch.execute({ patch: patchText(`*** Delete File: ${movedPath}`) })).status, 'success')
    assert.doesNotMatch(await readWorkspaceFile(workspaceRootPath, indexPath), /workflow/u)

    const addedPath = '.tidecode/memory/details/testing.md'
    const lines = memoryDetail('testing', 'Test commands and required checks.').trimEnd().split('\n').map((line) => `+${line}`).join('\n')
    assert.equal((await patch.execute({ patch: patchText(`*** Add File: ${addedPath}\n${lines}`) })).status, 'success')
    assert.match(await readWorkspaceFile(workspaceRootPath, indexPath), /\[testing\]\(details\/testing\.md\) - Test commands and required checks/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('concurrent memory writes retain every topic and index reads discover external changes', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-memory-concurrent-'))
  const context = { workspaceRootPath, enabledSkills: [], terminalExecutionMode: 'sandbox' as const }
  const write = createWriteTool(context) as unknown as ExecutableTool
  const read = createReadTool(context) as unknown as ExecutableTool
  try {
    const results = await Promise.all(['workflow', 'testing', 'architecture'].map((name) => write.execute({
      path: `.tidecode/memory/details/${name}.md`, content: memoryDetail(name, `When to read ${name}.`),
    })))
    assert.ok(results.every((result) => result.status === 'success'))
    const index = await readWorkspaceFile(workspaceRootPath, '.tidecode/memory/MEMORY.md')
    for (const name of ['workflow', 'testing', 'architecture']) {
      assert.ok(index.includes(`[${name}](details/${name}.md)`))
    }
    const externalPath = path.join(workspaceRootPath, '.tidecode/memory/details/external.md')
    await fs.writeFile(externalPath, memoryDetail('external', 'Externally recorded project conventions.'))
    const refreshed = await read.execute({ path: '@workspace/.tidecode/memory/MEMORY.md' })
    assert.equal(refreshed.status, 'success')
    assert.match(refreshed.body ?? '', /Externally recorded project conventions/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('invalid detail metadata remains discoverable without copying its body into the index', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-memory-invalid-'))
  try {
    const detailPath = path.join(workspaceRootPath, '.tidecode/memory/details/old.md')
    await fs.mkdir(path.dirname(detailPath), { recursive: true })
    await fs.writeFile(detailPath, '# Old memory\n\nKeep this knowledge intact.')
    const index = await refreshWorkspaceMemoryIndex(workspaceRootPath)
    assert.match(index?.content ?? '', /\[old\.md\]\(details\/old\.md\) - Metadata required/u)
    assert.doesNotMatch(index?.content ?? '', /Keep this knowledge intact/u)
    assert.equal(await fs.readFile(detailPath, 'utf8'), '# Old memory\n\nKeep this knowledge intact.')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('index refresh captures the previous index before replacing it and keeps it when capture fails', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-memory-capture-'))
  try {
    const detailPath = path.join(workspaceRootPath, '.tidecode/memory/details/workflow.md')
    const indexPath = path.join(workspaceRootPath, '.tidecode/memory/MEMORY.md')
    await fs.mkdir(path.dirname(detailPath), { recursive: true })
    await fs.writeFile(detailPath, memoryDetail('workflow', 'Original description.'))
    await refreshWorkspaceMemoryIndex(workspaceRootPath)
    const previousIndex = await fs.readFile(indexPath, 'utf8')
    await fs.writeFile(detailPath, memoryDetail('workflow', 'Changed description.'))
    let capturedIndex: string | null = null
    await assert.rejects(refreshWorkspaceMemoryIndex(workspaceRootPath, async (absolutePath) => {
      assert.equal(absolutePath, indexPath)
      capturedIndex = await fs.readFile(absolutePath, 'utf8')
      throw new Error('Capture failed')
    }), /Capture failed/u)
    assert.equal(capturedIndex, previousIndex)
    assert.equal(await fs.readFile(indexPath, 'utf8'), previousIndex)
    await refreshWorkspaceMemoryIndex(workspaceRootPath)
    assert.match(await fs.readFile(indexPath, 'utf8'), /Changed description/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('file tools report a saved detail separately from a failed index refresh and reads repair it', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-memory-refresh-failure-'))
  const context = { workspaceRootPath, enabledSkills: [], terminalExecutionMode: 'sandbox' as const }
  const write = createWriteTool(context) as unknown as ExecutableTool
  const read = createReadTool(context) as unknown as ExecutableTool
  const indexPath = path.join(workspaceRootPath, '.tidecode/memory/MEMORY.md')
  const detailPath = '.tidecode/memory/details/workflow.md'
  try {
    await fs.mkdir(indexPath, { recursive: true })
    const content = memoryDetail('workflow', 'Commands for daily development.')
    const result = await write.execute({ path: detailPath, content })
    assert.equal(result.status, 'error')
    assert.match(result.body ?? '', /detail changes were saved, but MEMORY.md could not be refreshed/u)
    assert.equal(await readWorkspaceFile(workspaceRootPath, detailPath), content)
    await fs.rmdir(indexPath)
    const repaired = await read.execute({ path: '.tidecode/memory/MEMORY.md' })
    assert.equal(repaired.status, 'success')
    assert.match(repaired.body ?? '', /Commands for daily development/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})


test('indexing bounds detail reads, reuses metadata, and updates only changed topics', async (t) => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-memory-index-cost-'))
  const details = path.join(workspaceRootPath, '.tidecode/memory/details')
  const firstPath = path.join(details, 'first.md')
  const secondPath = path.join(details, 'second.md')
  const context = { workspaceRootPath, enabledSkills: [], terminalExecutionMode: 'sandbox' as const }
  const write = createWriteTool(context) as unknown as ExecutableTool
  try {
    await fs.mkdir(details, { recursive: true })
    await fs.writeFile(firstPath, memoryDetail('first', 'First description.', 'Body. '.repeat(1_000_000)))
    await fs.writeFile(secondPath, memoryDetail('second', 'Second description.'))
    const originalOpen = fs.open.bind(fs)
    const reads: Array<{ file: string; bytes: number }> = []
    t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args)
      if (typeof args[0] === 'string' && args[0].startsWith(details + path.sep) && args[1] === 'r') {
        const originalRead = handle.read.bind(handle)
        handle.read = (async (...readArgs: Parameters<typeof originalRead>) => {
          const result = await originalRead(...readArgs)
          reads.push({ file: String(args[0]), bytes: result.bytesRead })
          return result
        }) as typeof handle.read
      }
      return handle
    })
    await refreshWorkspaceMemoryIndex(workspaceRootPath)
    assert.ok(reads.reduce((total, read) => total + read.bytes, 0) <= 1024, 'Body size must not increase indexing reads')
    reads.length = 0
    await refreshWorkspaceMemoryIndex(workspaceRootPath)
    assert.equal(reads.length, 0, 'Unchanged files must not be reopened')

    const result = await write.execute({ path: firstPath, content: memoryDetail('first', 'Updated description.') })
    assert.equal(result.status, 'success')
    assert.ok(reads.length > 0)
    assert.ok(reads.every((read) => read.file === firstPath), 'A mutation must read only affected metadata')
    assert.match(await readWorkspaceFile(workspaceRootPath, '.tidecode/memory/MEMORY.md'), /Updated description/u)
    reads.length = 0

    const readdir = t.mock.method(fs, 'readdir')
    assert.equal((await write.execute({ path: 'source.ts', content: 'export const value = 1' })).status, 'success')
    assert.equal(readdir.mock.callCount(), 0, 'Unrelated writes must not scan memory')
    assert.equal(reads.length, 0)

    const previousStats = await fs.stat(secondPath)
    await fs.writeFile(secondPath, memoryDetail('second', 'Edited description.'))
    await fs.utimes(secondPath, previousStats.atime, previousStats.mtime)
    await fs.unlink(firstPath)
    const external = await refreshWorkspaceMemoryIndex(workspaceRootPath)
    assert.match(external?.content ?? '', /Edited description/u)
    assert.doesNotMatch(external?.content ?? '', /details\/first\.md/u)
  } finally {
    t.mock.restoreAll()
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('oversized frontmatter has bounded reads and remains discoverable for repair', async (t) => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-memory-header-limit-'))
  const details = path.join(workspaceRootPath, '.tidecode/memory/details')
  const detailPath = path.join(details, 'oversized.md')
  try {
    await fs.mkdir(details, { recursive: true })
    await fs.writeFile(detailPath, memoryDetail('oversized', 'description '.repeat(10_000)))
    const originalOpen = fs.open.bind(fs)
    let bytesRead = 0
    t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args)
      if (args[0] === detailPath && args[1] === 'r') {
        const originalRead = handle.read.bind(handle)
        handle.read = (async (...readArgs: Parameters<typeof originalRead>) => {
          const result = await originalRead(...readArgs)
          bytesRead += result.bytesRead
          return result
        }) as typeof handle.read
      }
      return handle
    })
    const index = await refreshWorkspaceMemoryIndex(workspaceRootPath)
    assert.equal(bytesRead, 8 * 1024)
    assert.match(index?.content ?? '', /Metadata required/u)
    assert.doesNotMatch(index?.content ?? '', /description description/u)
  } finally {
    t.mock.restoreAll()
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('workspace metadata cache evicts old projects and rebuilds their current contents', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-memory-cache-bound-'))
  try {
    const workspaces = Array.from({ length: 5 }, (_, index) => path.join(root, String(index)))
    for (const workspace of workspaces) {
      const detailPath = path.join(workspace, '.tidecode/memory/details/topic.md')
      await fs.mkdir(path.dirname(detailPath), { recursive: true })
      await fs.writeFile(detailPath, memoryDetail('topic', 'Original description.'))
      await refreshWorkspaceMemoryIndex(workspace)
    }
    const firstDetail = path.join(workspaces[0], '.tidecode/memory/details/topic.md')
    await fs.writeFile(firstDetail, memoryDetail('topic', 'Current description.'))
    await fs.writeFile(path.join(path.dirname(firstDetail), 'external.md'), memoryDetail('external', 'New externally added topic.'))
    const rebuilt = await refreshWorkspaceMemoryIndex(workspaces[0], undefined, [firstDetail])
    assert.match(rebuilt?.content ?? '', /Current description/u)
    assert.match(rebuilt?.content ?? '', /New externally added topic/u)
    assert.doesNotMatch(rebuilt?.content ?? '', /Original description/u)
  } finally {
    await fs.rm(root, { force: true, recursive: true })
  }
})
