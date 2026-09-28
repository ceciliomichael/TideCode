import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { applyPatchInWorkspace } from '../../electron/chat/shared/applyPatchWorkspace'
import { createAgentToolBundle, createNativeAgentTools } from '../../electron/chat/shared/tools'
import {
  createEditToolResult,
  createWholeFileWriteToolResult,
  type WorkspaceToolContext,
} from '../../electron/chat/shared/tools/workspaceTools'
import { computeContentRevision } from '../../electron/chat/shared/tools/workspaceMutationSafety'

async function createFixture(content: string, fileName = 'target.ts') {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-mutation-reliability-'))
  const targetPath = path.join(workspaceRootPath, fileName)
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.writeFile(targetPath, content, 'utf8')
  const context: WorkspaceToolContext = {
    checkpointId: null,
    terminalExecutionMode: 'sandbox',
    workspaceRootPath,
  }
  return { context, targetPath, workspaceRootPath }
}

async function getCurrentRevision(targetPath: string) {
  return computeContentRevision(await fs.readFile(targetPath))
}

test('edit never applies a fuzzy-only near match', async () => {
  const originalContent = 'const alpha = 1\nconst beta = 2\n'
  const fixture = await createFixture(originalContent)
  try {
    await assert.rejects(
      createEditToolResult(fixture.context, {
        path: 'target.ts',
        edits: [{
          targetContent: 'const alpha = 1\nconst gamma = 2',
          replacementContent: 'const alpha = 10\nconst gamma = 20',
        }],
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal((error as { code?: string }).code, 'TARGET_NOT_FOUND')
        assert.match(error.message, /Closest candidate line range/u)
        return true
      },
    )
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), originalContent)
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('overlapping edit hunks fail before changing the file', async () => {
  const originalContent = 'const a = 1\nconst b = 2\nconst c = 3\n'
  const fixture = await createFixture(originalContent)
  try {
    await assert.rejects(
      createEditToolResult(fixture.context, {
        path: 'target.ts',
        edits: [
          {
            targetContent: 'const a = 1\nconst b = 2',
            replacementContent: 'const a = 10\nconst b = 20',
          },
          {
            targetContent: 'const b = 2\nconst c = 3',
            replacementContent: 'const b = 200\nconst c = 300',
          },
        ],
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal((error as { code?: string }).code, 'OVERLAPPING_EDITS')
        return true
      },
    )
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), originalContent)
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('edit rejects a stale read revision without overwriting newer content', async () => {
  const fixture = await createFixture('const value = 1\n')
  try {
    const revision = await getCurrentRevision(fixture.targetPath)
    const newerContent = 'const value = 99\n'
    await fs.writeFile(fixture.targetPath, newerContent, 'utf8')

    await assert.rejects(
      createEditToolResult(fixture.context, {
        path: 'target.ts',
        expectedRevision: revision,
        edits: [{ targetContent: 'const value = 1', replacementContent: 'const value = 2' }],
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal((error as { code?: string }).code, 'REVISION_CONFLICT')
        return true
      },
    )
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), newerContent)
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('write rejects a stale read revision without overwriting newer content', async () => {
  const fixture = await createFixture('const value = 1\n')
  try {
    const revision = await getCurrentRevision(fixture.targetPath)
    const newerContent = 'const value = 99\n'
    await fs.writeFile(fixture.targetPath, newerContent, 'utf8')

    await assert.rejects(
      createWholeFileWriteToolResult(fixture.context, {
        path: 'target.ts',
        expectedRevision: revision,
        content: 'const value = 2\n',
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal((error as { code?: string }).code, 'REVISION_CONFLICT')
        return true
      },
    )
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), newerContent)
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('edit preserves UTF-8 BOM and CRLF formatting', async () => {
  const originalContent = '\uFEFFconst a = 1\r\nconst b = 2\r\n'
  const fixture = await createFixture(originalContent)
  try {
    const result = await createEditToolResult(fixture.context, {
      path: 'target.ts',
      edits: [{ targetContent: 'const b = 2', replacementContent: 'const b = 20' }],
    })
    assert.equal(result.status, 'success')
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), '\uFEFFconst a = 1\r\nconst b = 20\r\n')
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('whole-file write preserves existing UTF-8 BOM and CRLF formatting', async () => {
  const originalContent = '\uFEFFconst a = 1\r\nconst b = 2\r\n'
  const fixture = await createFixture(originalContent)
  try {
    const result = await createWholeFileWriteToolResult(fixture.context, {
      path: 'target.ts',
      content: 'const a = 10\nconst b = 20\n',
    })
    assert.equal(result.status, 'success')
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), '\uFEFFconst a = 10\r\nconst b = 20\r\n')
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('same-revision concurrent edit and write cannot silently clobber the first mutation', async () => {
  const originalContent = 'export const first = 1\nexport const last = 3\n'
  const fixture = await createFixture(originalContent)
  try {
    const revision = await getCurrentRevision(fixture.targetPath)
    const outcomes = await Promise.allSettled([
      createEditToolResult(fixture.context, {
        path: 'target.ts',
        expectedRevision: revision,
        edits: [{ targetContent: 'export const first = 1', replacementContent: 'export const first = 100' }],
      }),
      createWholeFileWriteToolResult(fixture.context, {
        path: 'target.ts',
        expectedRevision: revision,
        content: 'export const first = 1\nexport const last = 300\n',
      }),
    ])

    assert.equal(outcomes[0].status, 'fulfilled')
    assert.equal(outcomes[1].status, 'rejected')
    if (outcomes[1].status === 'rejected') {
      assert.equal((outcomes[1].reason as { code?: string }).code, 'REVISION_CONFLICT')
    }
    assert.equal(
      await fs.readFile(fixture.targetPath, 'utf8'),
      'export const first = 100\nexport const last = 3\n',
    )
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('public edit returns structured error code and stage for ambiguous source', async () => {
  const originalContent = 'const item = 1\nconst item = 1\n'
  const fixture = await createFixture(originalContent)
  try {
    const tools = await createNativeAgentTools({ workspaceRootPath: fixture.workspaceRootPath }, { chatMode: 'agent' })
    const edit = tools.edit as unknown as {
      execute: (input: unknown) => Promise<{ status: string; semantics?: Record<string, unknown> }>
    }
    const result = await edit.execute({
      path: 'target.ts',
      edits: [{ targetContent: 'const item = 1', replacementContent: 'const item = 2' }],
    })
    assert.equal(result.status, 'error')
    assert.equal(result.semantics?.error_code, 'TARGET_AMBIGUOUS')
    assert.equal(result.semantics?.stage, 'TARGET_MATCH')
    assert.equal(result.semantics?.hunk_index, 1)
    assert.equal(result.semantics?.match_count, 2)
    assert.deepEqual(result.semantics?.candidate_line_ranges, ['1-1', '2-2'])
    assert.equal(result.semantics?.recoverable, true)
    const candidateContexts = result.semantics?.candidate_contexts as Array<{ content: string; line_range: string }> | undefined
    assert.deepEqual(candidateContexts?.map((context) => context.line_range), ['1-1', '2-2'])
    assert.match(candidateContexts?.[0]?.content ?? '', /const item = 1/u)
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), originalContent)
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('direct write and apply_patch preserve arbitrary nested mutation text outside Code Mode', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-payload-mutation-'))
  try {
    const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent' })
    assert.deepEqual(Object.keys(bundle.tools).sort(), ['apply_patch', 'code_mode', 'write'])
    const write = bundle.tools.write as unknown as {
      execute: (input: unknown, options: { abortSignal?: AbortSignal }) => Promise<{ status: string }>
    }
    const applyPatch = bundle.tools.apply_patch as unknown as {
      execute: (input: unknown, options: { abortSignal?: AbortSignal }) => Promise<{ status: string }>
    }
    const rawSource = [
      'const template = `hello ${name}`',
      'const json = {"quote":"double","path":"C:\\temp\\file"}',
      'const python = """triple quotes"""',
      'const regex = /[{}$\\]/gu',
      '```ts',
      'export const nested = true',
      '```',
      '',
    ].join('\n')

    const writeResult = await write.execute({ path: 'nested-source.txt', content: rawSource }, {})
    assert.equal(writeResult.status, 'success')
    assert.equal(await fs.readFile(path.join(workspaceRootPath, 'nested-source.txt'), 'utf8'), rawSource)

    const patch = [
      '*** Begin Patch',
      '*** Update File: nested-source.txt',
      '@@',
      '-const template = `hello ${name}`',
      '+const template = `hi ${name}`',
      '*** End Patch',
    ]
    const patchResult = await applyPatch.execute({ patch }, {})
    assert.equal(patchResult.status, 'success')
    assert.equal(
      await fs.readFile(path.join(workspaceRootPath, 'nested-source.txt'), 'utf8'),
      rawSource.replace('hello ${name}', 'hi ${name}'),
    )
    await bundle.codeModeExecutor?.dispose()
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('public edit returns structured recovery metadata for a missing target', async () => {
  const originalContent = 'const alpha = 1\nconst beta = 2\n'
  const fixture = await createFixture(originalContent)
  try {
    const tools = await createNativeAgentTools({ workspaceRootPath: fixture.workspaceRootPath }, { chatMode: 'agent' })
    const edit = tools.edit as unknown as {
      execute: (input: unknown) => Promise<{ status: string; semantics?: Record<string, unknown> }>
    }
    const result = await edit.execute({
      path: 'target.ts',
      edits: [{
        targetContent: 'const alpha = 1\nconst gamma = 2',
        replacementContent: 'const alpha = 10\nconst gamma = 20',
      }],
    })
    assert.equal(result.status, 'error')
    assert.equal(result.semantics?.error_code, 'TARGET_NOT_FOUND')
    assert.equal(result.semantics?.stage, 'TARGET_MATCH')
    assert.equal(result.semantics?.hunk_index, 1)
    assert.equal(result.semantics?.closest_candidate_line_range, '1-2')
    assert.equal(result.semantics?.recoverable, true)
    const closestContext = result.semantics?.closest_candidate_context as { content?: string; line_range?: string } | undefined
    assert.equal(closestContext?.line_range, '1-2')
    assert.match(closestContext?.content ?? '', /const beta = 2/u)
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), originalContent)
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('public edit supports exact line-range replacement without targetContent', async () => {
  const originalContent = 'keep first\nremove one\nremove two\nkeep last\n'
  const fixture = await createFixture(originalContent)
  try {
    const tools = await createNativeAgentTools({ workspaceRootPath: fixture.workspaceRootPath }, { chatMode: 'agent' })
    const edit = tools.edit as unknown as {
      execute: (input: unknown) => Promise<{ status: string }>
    }
    const result = await edit.execute({
      path: 'target.ts',
      edits: [{ startLine: 2, endLine: 3, replacementContent: '' }],
    })
    assert.equal(result.status, 'success')
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), 'keep first\nkeep last\n')
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('public edit supports exact file-boundary insertion without a text anchor', async () => {
  const originalContent = "test('existing', () => {})\n"
  const fixture = await createFixture(originalContent, 'append.test.ts')
  try {
    const tools = await createNativeAgentTools({ workspaceRootPath: fixture.workspaceRootPath }, { chatMode: 'agent' })
    const edit = tools.edit as unknown as {
      execute: (input: unknown) => Promise<{ status: string }>
    }
    const result = await edit.execute({
      path: 'append.test.ts',
      edits: [{ insertAt: 'end', insertContent: "\ntest('appended', () => {})\n" }],
    })
    assert.equal(result.status, 'success')
    assert.equal(
      await fs.readFile(fixture.targetPath, 'utf8'),
      "test('existing', () => {})\n\ntest('appended', () => {})\n",
    )
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('production Code Mode excludes edit while the native legacy edit tool remains available', async () => {
  const fixture = await createFixture('const value = 1\n')
  try {
    const bundle = await createAgentToolBundle(
      { workspaceRootPath: fixture.workspaceRootPath },
      { chatMode: 'agent', orchestrationMode: 'code_mode' },
    )
    assert.equal(bundle.registry.get('edit'), undefined)
    assert.ok(bundle.nativeTools.edit)
    const description = (bundle.tools.code_mode as { description?: string }).description ?? ''
    assert.doesNotMatch(description, /tools\.edit|targetContent|replacementContent|insertContent/u)
    await bundle.codeModeExecutor?.dispose()
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('successful atomic writes leave no temporary mutation files behind', async () => {
  const fixture = await createFixture('before\n')
  try {
    await createWholeFileWriteToolResult(fixture.context, { path: 'target.ts', content: 'after\n' })
    const entries = await fs.readdir(fixture.workspaceRootPath)
    assert.equal(entries.some((entry) => entry.includes('.tidecode-') && entry.endsWith('.tmp')), false)
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('write and apply_patch use a backup swap when Windows rejects replacing an existing target', async (t) => {
  const lineEnding = String.fromCharCode(10)
  const fixture = await createFixture('before' + lineEnding)
  const realRename = fs.rename.bind(fs)

  t.mock.method(fs, 'rename', async (sourcePath, destinationPath) => {
    const source = String(sourcePath)
    const destination = String(destinationPath)
    if (destination === fixture.targetPath && source.includes('.tidecode-') && source.endsWith('.tmp')) {
      const targetExists = await fs.stat(fixture.targetPath).then(() => true).catch(() => false)
      if (targetExists) {
        const error = new Error('simulated Windows replace failure') as NodeJS.ErrnoException
        error.code = 'EPERM'
        throw error
      }
    }
    await realRename(sourcePath, destinationPath)
  })

  try {
    await createWholeFileWriteToolResult(fixture.context, { path: 'target.ts', content: 'after' + lineEnding })
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), 'after' + lineEnding)

    const patch = [
      '*** Begin Patch',
      '*** Update File: target.ts',
      '@@',
      '-after',
      '+patched',
      '*** End Patch',
    ].join(lineEnding)
    await applyPatchInWorkspace(fixture.workspaceRootPath, patch)
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), 'patched' + lineEnding)

    const entries = await fs.readdir(fixture.workspaceRootPath)
    assert.equal(entries.some((entry) => entry.includes('.tidecode-') && (entry.endsWith('.tmp') || entry.endsWith('.bak'))), false)
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('apply_patch holds the same-file mutation queue until its transaction commits', async () => {
  const fixture = await createFixture('before\n')
  let releasePatch: (() => void) | undefined
  let markPatchReady: (() => void) | undefined
  const patchReady = new Promise<void>((resolve) => { markPatchReady = resolve })
  const patchRelease = new Promise<void>((resolve) => { releasePatch = resolve })
  const patch = [
    '*** Begin Patch',
    '*** Update File: target.ts',
    '@@',
    '-before',
    '+patched',
    '*** End Patch',
  ].join('\n')

  try {
    const patchPromise = applyPatchInWorkspace(fixture.workspaceRootPath, patch, {
      onBeforeChange: async () => {
        markPatchReady?.()
        await patchRelease
      },
    })
    await patchReady

    const writePromise = createWholeFileWriteToolResult(fixture.context, {
      path: 'target.ts',
      content: 'written-after-patch\n',
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), 'before\n')

    releasePatch?.()
    await Promise.all([patchPromise, writePromise])
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), 'written-after-patch\n')
  } finally {
    releasePatch?.()
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})
