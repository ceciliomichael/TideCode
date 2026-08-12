import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { applyPatchInWorkspace } from '../../electron/chat/shared/applyPatchWorkspace'
import { createApplyPatchTool } from '../../electron/chat/shared/tools/applyPatchTool'
import { createAgentToolBundle } from '../../electron/chat/shared/tools'

function standardPatch(body: string) {
  return `*** Begin Patch\n${body}\n*** End Patch`
}

test('apply_patch updates standard Codex patches with whitespace-tolerant context', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-apply-patch-'))
  const targetPath = path.join(workspaceRootPath, 'src', 'value.ts')

  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, 'function value() {\r\n    return 1\r\n}\r\n', 'utf8')

    const result = await applyPatchInWorkspace(
      workspaceRootPath,
      standardPatch(`*** Update File: src/value.ts\n@@\n function value() {\n return 1\n }\n+export const ready = true;`),
    )

    assert.equal(result.changes.length, 1)
    assert.equal(
      await fs.readFile(targetPath, 'utf8'),
      'function value() {\n    return 1\n}\nexport const ready = true;\n',
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('apply_patch follows Codex first-match sequencing for repeated hunks', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-apply-patch-sequence-'))
  const targetPath = path.join(workspaceRootPath, 'repeated.ts')

  try {
    await fs.writeFile(targetPath, 'repeat\nkeep\nrepeat\nkeep\n', 'utf8')

    await applyPatchInWorkspace(
      workspaceRootPath,
      standardPatch(`*** Update File: repeated.ts
@@
-repeat
+first
@@
-repeat
+second`),
    )

    assert.equal(await fs.readFile(targetPath, 'utf8'), 'first\nkeep\nsecond\nkeep\n')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('apply_patch accepts array-of-lines input when source contains template literals', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-apply-patch-lines-'))
  const targetPath = path.join(workspaceRootPath, 'src', 'panel.tsx')

  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, 'const width = `${panelWidth}px`\n', 'utf8')

    const result = await applyPatchInWorkspace(
      workspaceRootPath,
      [
        '*** Begin Patch',
        '*** Update File: src/panel.tsx',
        '@@',
        '-const width = `${panelWidth}px`',
        '+const width = `${panelMaxWidth}px`',
        '*** End Patch',
      ].join('\n'),
    )

    assert.equal(result.changes.length, 1)
    assert.equal(await fs.readFile(targetPath, 'utf8'), 'const width = `${panelMaxWidth}px`\n')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('apply_patch verifies every file before changing any file', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-apply-patch-atomic-'))
  const existingPath = path.join(workspaceRootPath, 'existing.ts')
  const createdPath = path.join(workspaceRootPath, 'created.ts')

  try {
    await fs.writeFile(existingPath, 'alpha\nbeta\n', 'utf8')

    await assert.rejects(
      applyPatchInWorkspace(
        workspaceRootPath,
        standardPatch(`*** Add File: created.ts\n+created\n*** Update File: existing.ts\n@@\n missing\n+replacement`),
      ),
      /Failed to find expected lines/u,
    )

    await assert.rejects(fs.readFile(createdPath, 'utf8'))
    assert.equal(await fs.readFile(existingPath, 'utf8'), 'alpha\nbeta\n')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('apply_patch explains when a long source line was supplied as a partial anchor', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-apply-patch-partial-'))
  const targetPath = path.join(workspaceRootPath, 'src', 'chatMentions.ts')
  const currentLine = 'const LEGACY_ACTION_REGEX = /(?:^|[\\s(])((?:read|list|load_skill):(?:(?:"([^"]+)")))/g'

  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, `${currentLine}\n`, 'utf8')

    await assert.rejects(
      applyPatchInWorkspace(
        workspaceRootPath,
        standardPatch(`*** Update File: src/chatMentions.ts\n@@\n-${currentLine.slice(0, 78)}\n+const LEGACY_ACTION_REGEX = /(?:^|[\\s(])((?:read|list|load_skill|kanban):`),
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /partial source line/u)
        assert.match(error.message, /Current source near the match/u)
        assert.ok(error.message.includes(currentLine))
        return true
      },
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('apply_patch supports add, update, move, and delete in one patch', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-apply-patch-files-'))

  try {
    await fs.writeFile(path.join(workspaceRootPath, 'old.ts'), 'const value = 1\n', 'utf8')
    await fs.writeFile(path.join(workspaceRootPath, 'remove.ts'), 'remove\n', 'utf8')

    const result = await applyPatchInWorkspace(
      workspaceRootPath,
      standardPatch(`*** Add File: new.ts\n+created\n*** Update File: old.ts\n*** Move to: renamed.ts\n@@\n-const value = 1\n+const value = 2\n*** Delete File: remove.ts`),
    )

    assert.equal(result.changes.length, 3)
    assert.equal(await fs.readFile(path.join(workspaceRootPath, 'new.ts'), 'utf8'), 'created\n')
    assert.equal(await fs.readFile(path.join(workspaceRootPath, 'renamed.ts'), 'utf8'), 'const value = 2\n')
    await assert.rejects(fs.readFile(path.join(workspaceRootPath, 'old.ts'), 'utf8'))
    await assert.rejects(fs.readFile(path.join(workspaceRootPath, 'remove.ts'), 'utf8'))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('apply_patch returns the same file diff result contract as edit', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-apply-patch-result-'))
  const targetPath = path.join(workspaceRootPath, 'value.ts')

  try {
    await fs.writeFile(targetPath, 'const value = 1\n', 'utf8')
    const applyPatchTool = createApplyPatchTool({ workspaceRootPath })
    const execute = (applyPatchTool as {
      execute?: (input: unknown, options: Record<string, unknown>) => Promise<unknown>
    }).execute
    assert.equal(typeof execute, 'function')

    const result = await execute?.(
      { patch: standardPatch(`*** Update File: value.ts\n@@\n-const value = 1\n+const value = 2`).split('\n') },
      { context: {}, messages: [], toolCallId: 'apply-patch-test' },
    ) as {
      body?: string
      resultPresentation?: { kind?: string; changes?: unknown[] }
      semantics?: Record<string, unknown>
      status?: string
      summary?: string
    }

    assert.equal(result.status, 'success')
    assert.equal(result.resultPresentation?.kind, 'change_diff')
    assert.equal(result.resultPresentation?.changes?.length, 1)
    assert.equal(result.semantics?.operation, 'edit')
    assert.match(result.summary ?? '', /Applied patch/u)
    assert.match(result.body ?? '', /M value\.ts/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('apply_patch rejects the legacy string input at the AI-facing boundary', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-apply-patch-input-'))
  const targetPath = path.join(workspaceRootPath, 'value.ts')

  try {
    await fs.writeFile(targetPath, 'const value = 1\n', 'utf8')
    const applyPatchTool = createApplyPatchTool({ workspaceRootPath })
    const execute = (applyPatchTool as {
      execute?: (input: unknown, options: Record<string, unknown>) => Promise<unknown>
    }).execute
    const result = await execute?.(
      { patch: standardPatch(`*** Update File: value.ts\n@@\n-const value = 1\n+const value = 2`) },
      { context: {}, messages: [], toolCallId: 'apply-patch-input-test' },
    ) as { status?: string; summary?: string }

    assert.equal(result.status, 'error')
    assert.match(result.summary ?? '', /array of complete patch lines/u)
    assert.equal(await fs.readFile(targetPath, 'utf8'), 'const value = 1\n')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('apply_patch rejects legacy XML and heredoc wrappers', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-apply-patch-format-'))

  try {
    const applyPatchTool = createApplyPatchTool({ workspaceRootPath })
    const execute = (applyPatchTool as {
      execute?: (input: unknown, options: Record<string, unknown>) => Promise<unknown>
    }).execute

    for (const patch of [
      ['<patch>', '<add path="value.ts">', '+const value = 1', '</add>', '</patch>'],
      ['apply_patch <<EOF', '*** Begin Patch', '*** End Patch', 'EOF'],
    ]) {
      const result = await execute?.(
        { patch },
        { context: {}, messages: [], toolCallId: 'apply-patch-format-test' },
      ) as { status?: string; summary?: string }

      assert.equal(result.status, 'error')
      assert.match(result.summary ?? '', /Invalid patch format/u)
    }
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode can execute edit without exposing patch as a provider tool', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-edit-code-mode-'))
  let codeModeExecutor: { dispose: () => Promise<void> } | null = null

  try {
    await fs.writeFile(path.join(workspaceRootPath, 'value.ts'), 'const value = 1\n', 'utf8')
    const bundle = await createAgentToolBundle(
      { workspaceRootPath },
      { chatMode: 'agent', orchestrationMode: 'code_mode' },
    )
    codeModeExecutor = bundle.codeModeExecutor
    assert.ok(bundle.registry.get('edit'))
    assert.equal(bundle.registry.get('patch'), undefined)
    assert.deepEqual(Object.keys(bundle.tools).sort(), ['code_mode', 'tool_search'])
    assert.match(
      ((bundle.tools.code_mode as { description?: string }).description ?? ''),
      /tools\.edit\(\{ edits: Array<object>, path: string \}/u,
    )

    const execute = (bundle.tools.code_mode as {
      execute?: (input: unknown, options: Record<string, unknown>) => Promise<unknown>
    }).execute
    const editCode = "const result = await tools.edit({ path: 'value.ts', edits: [{ targetContent: 'const value = 1', replacementContent: 'const value = 2', startLine: 1, endLine: 1 }] }); return { status: result.status }"
    const result = await execute?.(
      { code: editCode },
      { context: {}, messages: [], toolCallId: 'edit-code-mode-test' },
    ) as { body?: string; status?: string }

    assert.equal(result.status, 'success')
    assert.match(result.body ?? '', /"status": "success"/u)
    assert.equal(await fs.readFile(path.join(workspaceRootPath, 'value.ts'), 'utf8'), 'const value = 2\n')

  } finally {
    await codeModeExecutor?.dispose()
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
