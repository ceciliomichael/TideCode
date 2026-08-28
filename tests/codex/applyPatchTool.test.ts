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

test('apply_patch retries transient atomic install failures', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-apply-patch-retry-'))
  const targetPath = path.join(workspaceRootPath, 'value.txt')
  const mutableFs = fs as unknown as { rename: typeof fs.rename }
  const originalRename = fs.rename
  let renameAttempts = 0

  try {
    await fs.writeFile(targetPath, 'before\n', 'utf8')
    mutableFs.rename = async (sourcePath, destinationPath) => {
      if (path.resolve(String(destinationPath)) === targetPath && renameAttempts < 2) {
        renameAttempts += 1
        throw Object.assign(new Error('simulated transient Windows file lock'), { code: 'UNKNOWN' })
      }
      renameAttempts += 1
      return originalRename(sourcePath, destinationPath)
    }

    await applyPatchInWorkspace(
      workspaceRootPath,
      standardPatch('*** Update File: value.txt\n@@\n-before\n+after'),
    )

    assert.equal(await fs.readFile(targetPath, 'utf8'), 'after\n')
    assert.equal(renameAttempts, 3)
  } finally {
    mutableFs.rename = originalRename
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
test('apply_patch rolls back only files committed before a later install failure', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-apply-patch-rollback-'))
  const firstPath = path.join(workspaceRootPath, 'first.txt')
  const secondPath = path.join(workspaceRootPath, 'second.txt')
  const mutableFs = fs as unknown as { rename: typeof fs.rename }
  const originalRename = fs.rename
  let secondRenameAttempts = 0

  try {
    await fs.writeFile(firstPath, 'first before\n', 'utf8')
    await fs.writeFile(secondPath, 'second before\n', 'utf8')
    mutableFs.rename = async (sourcePath, destinationPath) => {
      if (path.resolve(String(destinationPath)) === secondPath) {
        secondRenameAttempts += 1
        throw Object.assign(new Error('simulated persistent Windows file lock'), { code: 'UNKNOWN' })
      }
      return originalRename(sourcePath, destinationPath)
    }

    await assert.rejects(
      applyPatchInWorkspace(
        workspaceRootPath,
        standardPatch(
          '*** Update File: first.txt\n@@\n-first before\n+first after\n*** Update File: second.txt\n@@\n-second before\n+second after',
        ),
      ),
      (error: unknown) => {
        assert.match(String(error), /simulated persistent Windows file lock/u)
        assert.doesNotMatch(String(error), /rollback also failed/u)
        return true
      },
    )

    assert.equal(await fs.readFile(firstPath, 'utf8'), 'first before\n')
    assert.equal(await fs.readFile(secondPath, 'utf8'), 'second before\n')
    assert.ok(secondRenameAttempts > 1)
  } finally {
    mutableFs.rename = originalRename
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

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

test('apply_patch keeps repeated hunks in source order when an earlier match needs whitespace normalization', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-apply-patch-whitespace-sequence-'))
  const targetPath = path.join(workspaceRootPath, 'repeated.ts')

  try {
    await fs.writeFile(
      targetPath,
      [
        "                {activeCardCount} active · {blockedCardCount} blocked ·{' '}",
        'keep',
        "              {activeCardCount} active · {blockedCardCount} blocked ·{' '}",
        '',
      ].join('\n'),
      'utf8',
    )

    await applyPatchInWorkspace(
      workspaceRootPath,
      standardPatch(`*** Update File: repeated.ts
@@
-              {activeCardCount} active · {blockedCardCount} blocked ·{' '}
+              {activeCardCount} active · {resolvedCardCount} resolved ·{' '}
@@
-              {activeCardCount} active · {blockedCardCount} blocked ·{' '}
+              {activeCardCount} active · {resolvedCardCount} resolved ·{' '}`),
    )

    assert.equal(
      await fs.readFile(targetPath, 'utf8'),
      [
        "              {activeCardCount} active · {resolvedCardCount} resolved ·{' '}",
        'keep',
        "              {activeCardCount} active · {resolvedCardCount} resolved ·{' '}",
        '',
      ].join('\n'),
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('apply_patch safely recovers unique out-of-order hunks in one file', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-apply-patch-out-of-order-'))
  const targetPath = path.join(workspaceRootPath, 'kanbanTools.ts')
  const originalContent = [
    '                const colTitle =',
    "                  colId === 'in-progress'",
    "                    ? 'In Progress'",
    '                    : colId.charAt(0).toUpperCase() + colId.slice(1)',
    '              return ok(`Created task in ${card.columnId}: ${card.title}`, { card })',
    '              return ok(`Moved task to ${card.columnId}: ${card.title}`, { card })',
    '',
  ].join('\n')

  try {
    await fs.writeFile(targetPath, originalContent, 'utf8')

    await applyPatchInWorkspace(
      workspaceRootPath,
      standardPatch(`*** Update File: kanbanTools.ts
@@
-              return ok(\`Created task in \${card.columnId}: \${card.title}\`, { card })
+              return ok(\`Created task in \${getKanbanColumnTitle(card.columnId)}: \${card.title}\`, { card })
@@
-                const colTitle =
-                  colId === 'in-progress'
-                    ? 'In Progress'
-                    : colId.charAt(0).toUpperCase() + colId.slice(1)
+                const colTitle = getKanbanColumnTitle(colId)
@@
-              return ok(\`Moved task to \${card.columnId}: \${card.title}\`, { card })
+              return ok(\`Moved task to \${getKanbanColumnTitle(card.columnId)}: \${card.title}\`, { card })`),
    )

    assert.equal(
      await fs.readFile(targetPath, 'utf8'),
      [
        '                const colTitle = getKanbanColumnTitle(colId)',
        '              return ok(`Created task in ${getKanbanColumnTitle(card.columnId)}: ${card.title}`, { card })',
        '              return ok(`Moved task to ${getKanbanColumnTitle(card.columnId)}: ${card.title}`, { card })',
        '',
      ].join('\n'),
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('apply_patch rejects ambiguous out-of-order recovery', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-apply-patch-out-of-order-ambiguous-'))
  const targetPath = path.join(workspaceRootPath, 'ambiguous.ts')
  const originalContent = 'early\nkeep\nearly\nlate\n'

  try {
    await fs.writeFile(targetPath, originalContent, 'utf8')

    await assert.rejects(
      applyPatchInWorkspace(
        workspaceRootPath,
        standardPatch(`*** Update File: ambiguous.ts
@@
-late
+LATE
@@
-early
+EARLY`),
      ),
      /Failed to find expected lines/u,
    )
    assert.equal(await fs.readFile(targetPath, 'utf8'), originalContent)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('apply_patch rejects overlapping out-of-order recovery', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-apply-patch-out-of-order-overlap-'))
  const targetPath = path.join(workspaceRootPath, 'overlap.ts')
  const originalContent = 'alpha\nbeta\ngamma\ndelta\n'

  try {
    await fs.writeFile(targetPath, originalContent, 'utf8')

    await assert.rejects(
      applyPatchInWorkspace(
        workspaceRootPath,
        standardPatch(`*** Update File: overlap.ts
@@
-beta
-gamma
+BETA-GAMMA
@@
-alpha
-beta
+ALPHA-BETA`),
      ),
      /Failed to find expected lines/u,
    )
    assert.equal(await fs.readFile(targetPath, 'utf8'), originalContent)
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
        assert.doesNotMatch(error.message, /Current revision|sha256:/u)
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

test('apply_patch presents each update hunk as a separate change while keeping file counts accurate', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-apply-patch-hunk-presentation-'))
  const targetPath = path.join(workspaceRootPath, 'value.ts')
  const removePath = path.join(workspaceRootPath, 'remove.ts')

  try {
    await fs.writeFile(targetPath, 'const anchor = 0\nconst first = 1\nconst middle = 2\nconst last = 3\n', 'utf8')
    await fs.writeFile(removePath, 'obsolete\n', 'utf8')
    const applyPatchTool = createApplyPatchTool({ workspaceRootPath })
    const execute = (applyPatchTool as {
      execute?: (input: unknown, options: Record<string, unknown>) => Promise<unknown>
    }).execute

    const result = await execute?.(
      {
        patch: standardPatch([
          '*** Add File: created.ts',
          '+created',
          '*** Update File: value.ts',
          '@@',
          ' const anchor = 0',
          '@@',
          '-const first = 1',
          '+const first = 10',
          '@@',
          '-const middle = 2',
          '+const middle = 20',
          '@@',
          '-const last = 3',
          '+const last = 30',
          '*** Delete File: remove.ts',
        ].join('\n')).split('\n'),
      },
      { context: {}, messages: [], toolCallId: 'apply-patch-hunk-presentation-test' },
    ) as {
      resultPresentation?: {
        kind?: string
        changes?: Array<{
          fileName?: string
          kind?: string
          newContent?: string
          oldContent?: string | null
          startLineNumber?: number
        }>
      }
      semantics?: Record<string, unknown>
      status?: string
      summary?: string
    }

    assert.equal(result.status, 'success')
    assert.equal(result.resultPresentation?.kind, 'change_diff')
    assert.deepEqual(
      result.resultPresentation?.changes?.map((change) => [change.fileName, change.kind]),
      [
        ['created.ts', 'add'],
        ['value.ts', 'update'],
        ['value.ts', 'update'],
        ['value.ts', 'update'],
        ['remove.ts', 'delete'],
      ],
    )
    assert.deepEqual(
      result.resultPresentation?.changes?.slice(1, 4).map((change) => [change.oldContent, change.newContent]),
      [
        ['const first = 1', 'const first = 10'],
        ['const middle = 2', 'const middle = 20'],
        ['const last = 3', 'const last = 30'],
      ],
    )
    assert.deepEqual(
      result.resultPresentation?.changes?.slice(1, 4).map((change) => change.startLineNumber),
      [2, 3, 4],
    )
    assert.ok(result.resultPresentation?.changes?.every((change) => change.oldContent !== change.newContent))
    assert.equal(result.semantics?.added_path_count, 1)
    assert.equal(result.semantics?.updated_path_count, 1)
    assert.equal(result.semantics?.deleted_path_count, 1)
    assert.deepEqual(result.semantics?.changed_paths, ['created.ts', 'value.ts', 'remove.ts'])
    assert.equal(await fs.readFile(targetPath, 'utf8'), 'const anchor = 0\nconst first = 10\nconst middle = 20\nconst last = 30\n')
    assert.equal(await fs.readFile(path.join(workspaceRootPath, 'created.ts'), 'utf8'), 'created\n')
    await assert.rejects(fs.readFile(removePath, 'utf8'))
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

test('apply_patch normalizes outer envelope echoes but rejects interior duplicates', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-apply-patch-envelope-'))
  const targetPath = path.join(workspaceRootPath, 'value.ts')

  try {
    await fs.writeFile(targetPath, 'const value = 1\n', 'utf8')
    const applyPatchTool = createApplyPatchTool({ workspaceRootPath })
    const execute = (applyPatchTool as {
      execute?: (input: unknown, options: Record<string, unknown>) => Promise<unknown>
    }).execute

    const echoedEnvelopeResult = await execute?.(
      {
        patch: [
          '*** Begin Patch',
          '*** Begin Patch',
          '*** Update File: value.ts',
          '@@',
          '-const value = 1',
          '+const value = 2',
          '*** End Patch',
          'EndPatch',
        ],
      },
      { context: {}, messages: [], toolCallId: 'apply-patch-envelope-echo-test' },
    ) as { status?: string; summary?: string }

    assert.equal(echoedEnvelopeResult.status, 'success')
    assert.equal(await fs.readFile(targetPath, 'utf8'), 'const value = 2\n')

    const interiorDuplicateResult = await execute?.(
      {
        patch: [
          '*** Begin Patch',
          '*** Update File: value.ts',
          '*** Begin Patch',
          '@@',
          '-const value = 2',
          '+const value = 3',
          '*** End Patch',
        ],
      },
      { context: {}, messages: [], toolCallId: 'apply-patch-interior-begin-test' },
    ) as { status?: string; summary?: string }

    assert.equal(interiorDuplicateResult.status, 'error')
    assert.match(interiorDuplicateResult.summary ?? '', /Begin Patch/u)
    assert.equal(await fs.readFile(targetPath, 'utf8'), 'const value = 2\n')
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

test('apply_patch resolves later hunks against the original file when an earlier hunk changes line count', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-apply-patch-shift-'))
  const targetPath = path.join(workspaceRootPath, 'shift.ts')

  try {
    await fs.writeFile(targetPath, 'one\nanchor\ntwo\ntarget\nthree\n', 'utf8')
    await applyPatchInWorkspace(
      workspaceRootPath,
      standardPatch('*** Update File: shift.ts\n@@\n-anchor\n+anchor-a\n+anchor-b\n+anchor-c\n@@\n-target\n+changed'),
    )

    assert.equal(
      await fs.readFile(targetPath, 'utf8'),
      'one\nanchor-a\nanchor-b\nanchor-c\ntwo\nchanged\nthree\n',
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('apply_patch honors end-of-file context when the source has no trailing newline', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-apply-patch-eof-'))
  const targetPath = path.join(workspaceRootPath, 'eof.ts')

  try {
    await fs.writeFile(targetPath, 'alpha\nomega', 'utf8')
    await applyPatchInWorkspace(
      workspaceRootPath,
      standardPatch('*** Update File: eof.ts\n@@\n omega\n+tail\n*** End of File'),
    )

    assert.equal(await fs.readFile(targetPath, 'utf8'), 'alpha\nomega\ntail\n')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode exposes apply_patch while edit remains native-only compatibility', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-patch-code-mode-'))
  let codeModeExecutor: { dispose: () => Promise<void> } | null = null

  try {
    await fs.writeFile(path.join(workspaceRootPath, 'value.ts'), 'const value = 1\nconst enabled = false\n', 'utf8')
    const bundle = await createAgentToolBundle(
      { workspaceRootPath },
      { chatMode: 'agent', orchestrationMode: 'code_mode' },
    )
    codeModeExecutor = bundle.codeModeExecutor
    assert.ok(bundle.registry.get('apply_patch'))
    assert.equal(bundle.registry.get('edit'), undefined)
    assert.ok(bundle.nativeTools.edit)
    assert.deepEqual(Object.keys(bundle.tools), ['code_mode'])
    assert.ok(bundle.registry.get('tool_search'))
    const description = (bundle.tools.code_mode as { description?: string }).description ?? ''
    assert.match(description, /tools\.apply_patch\(input: string\)/u)
    assert.match(description, /primary API for targeted source changes/u)
    assert.doesNotMatch(description, /tools\.edit/u)

    const execute = (bundle.tools.code_mode as {
      execute?: (input: unknown, options: Record<string, unknown>) => Promise<unknown>
    }).execute
    const patch = [
      '*** Begin Patch',
      ...standardPatch('*** Update File: value.ts\n@@\n-const value = 1\n+const value = 2').split('\n'),
    ].join('\n')
    const source = `const result = await tools.apply_patch(${JSON.stringify(patch)}); return { status: result.status, operation: result.semantics.operation }`
    const patchResult = await execute?.(
      { source },
      { context: {}, messages: [], toolCallId: 'apply-patch-code-mode-test' },
    ) as { body?: string; status?: string }

    assert.equal(patchResult.status, 'success')
    assert.match(patchResult.body ?? '', /"operation": "edit"/u)
    assert.equal(await fs.readFile(path.join(workspaceRootPath, 'value.ts'), 'utf8'), 'const value = 2\nconst enabled = false\n')

    const nativeEdit = bundle.nativeTools.edit as unknown as {
      execute: (input: unknown) => Promise<{ status?: string }>
    }
    const editResult = await nativeEdit.execute({
      path: 'value.ts',
      edits: [{ targetContent: 'const enabled = false', replacementContent: 'const enabled = true' }],
    })

    assert.equal(editResult.status, 'success')
    assert.equal(await fs.readFile(path.join(workspaceRootPath, 'value.ts'), 'utf8'), 'const value = 2\nconst enabled = true\n')

  } finally {
    await codeModeExecutor?.dispose()
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode apply_patch templates preserve literal source escapes', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-patch-template-literal-'))
  let codeModeExecutor: { dispose: () => Promise<void>; run: (source: string) => Promise<{ status: string; toolCalls: Array<{ name: string }> }> } | null = null

  try {
    const bundle = await createAgentToolBundle(
      { workspaceRootPath },
      { chatMode: 'agent', orchestrationMode: 'code_mode' },
    )
    codeModeExecutor = bundle.codeModeExecutor
    assert.ok(codeModeExecutor)

    const expected = [
      "const newline = '\\n';",
      "const tab = '\\t';",
      "const carriage = '\\r';",
      "const hex = '\\x41';",
      "const unicode = '\\u0041';",
      'const regex = /\\s+\\w+/;',
      "const windowsPath = 'C:\\new\\test';",
      'const template = `hello ${name}`;',
      '',
    ].join('\n')
    const patchText = [
      '*** Begin Patch',
      '*** Add File: literal.ts',
      ...expected.trimEnd().split('\n').map((line) => '+' + line),
      '*** End Patch',
    ].join('\n')
    const tick = String.fromCharCode(96)
    const source = 'const patch = ' + tick + patchText + tick + '; return await tools.apply_patch(patch)'
    const result = await codeModeExecutor.run(source)

    assert.equal(result.status, 'success')
    assert.deepEqual(result.toolCalls.map((call) => call.name), ['apply_patch'])
    assert.equal(await fs.readFile(path.join(workspaceRootPath, 'literal.ts'), 'utf8'), expected)
  } finally {
    await codeModeExecutor?.dispose()
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode leaves unrelated patch-looking templates as normal JavaScript', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-patch-template-unrelated-'))
  let codeModeExecutor: { dispose: () => Promise<void>; run: (source: string) => Promise<{ output?: unknown; status: string }> } | null = null

  try {
    const bundle = await createAgentToolBundle(
      { workspaceRootPath },
      { chatMode: 'agent', orchestrationMode: 'code_mode' },
    )
    codeModeExecutor = bundle.codeModeExecutor
    assert.ok(codeModeExecutor)

    const tick = String.fromCharCode(96)
    const source = "const name = 'value'; const text = " + tick + '*** Begin Patch\n${name}\n*** End Patch' + tick + '; return text'
    const result = await codeModeExecutor.run(source)

    assert.equal(result.status, 'success')
    assert.equal(result.output, '*** Begin Patch\nvalue\n*** End Patch')
  } finally {
    await codeModeExecutor?.dispose()
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
