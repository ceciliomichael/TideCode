import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CodeModeExecutor } from '../../electron/chat/shared/codeMode/executor'
import { createAgentToolBundle, createNativeAgentTools } from '../../electron/chat/shared/tools'
import { createCodeModeTool } from '../../electron/chat/shared/tools/metaTools'
import { createAgentToolRegistry } from '../../electron/chat/shared/tools/registry'
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

async function createInternalEditCompatibilityBundle(workspaceRootPath: string) {
  const nativeTools = await createNativeAgentTools({ workspaceRootPath }, { chatMode: 'agent' })
  const registry = await createAgentToolRegistry(nativeTools)
  const codeModeExecutor = new CodeModeExecutor(registry, registry.entries.map((entry) => entry.name), {
    terminalExecutionMode: 'sandbox',
    workspaceRootPath,
  })
  return {
    codeModeExecutor,
    nativeTools,
    registry,
    tools: { code_mode: createCodeModeTool(codeModeExecutor, registry) },
  }
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

test('Code Mode source strings preserve arbitrary nested text for write and apply_patch', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-payload-mutation-'))
  try {
    const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent' })
    assert.deepEqual(Object.keys(bundle.tools), ['code_mode'])
    const codeMode = bundle.tools.code_mode as unknown as {
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

    const writeSource = `return await tools.write({ path: 'nested-source.txt', content: ${JSON.stringify(rawSource)} })`
    const writeResult = await codeMode.execute({ source: writeSource }, {})
    assert.equal(writeResult.status, 'success')
    assert.equal(await fs.readFile(path.join(workspaceRootPath, 'nested-source.txt'), 'utf8'), rawSource)

    const patch = [
      '*** Begin Patch',
      '*** Update File: nested-source.txt',
      '@@',
      '-const template = `hello ${name}`',
      '+const template = `hi ${name}`',
      '*** End Patch',
    ].join('\n')
    const patchSource = `return await tools.apply_patch(${JSON.stringify(patch)})`
    const patchResult = await codeMode.execute({ source: patchSource }, {})
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

test('Code Mode repairs lineStart/lineEnd into an exact range edit before validation', async () => {
  const lines = Array.from({ length: 180 }, (_value, index) => `line ${index + 1}`)
  const originalContent = `${lines.join('\n')}\n`
  const fixture = await createFixture(originalContent, 'kanbanAcceptanceCriteriaAutoComplete.test.ts')
  try {
    const bundle = await createInternalEditCompatibilityBundle(fixture.workspaceRootPath)
    const codeMode = bundle.tools.code_mode as unknown as {
      execute: (input: unknown, options: { abortSignal?: AbortSignal }) => Promise<{ status: string }>
    }
    const result = await codeMode.execute({
      source: "return await tools.edit({ path: 'kanbanAcceptanceCriteriaAutoComplete.test.ts', edits: [{ lineStart: 144, lineEnd: 178, replacementContent: '' }] })",
    }, {})
    assert.equal(result.status, 'success')
    const expected = [...lines.slice(0, 143), ...lines.slice(178)].join('\n') + '\n'
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), expected)
    await bundle.codeModeExecutor?.dispose()
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode resolves structured ambiguous edits as recoverable results', async () => {
  const originalContent = 'const item = 1\nconst item = 1\n'
  const fixture = await createFixture(originalContent)
  try {
    const bundle = await createInternalEditCompatibilityBundle(fixture.workspaceRootPath)
    assert.ok(bundle.codeModeExecutor)
    const result = await bundle.codeModeExecutor.run(`
      const edit = await tools.edit({ path: 'target.ts', edits: [{ targetContent: 'const item = 1', replacementContent: 'const item = 2' }] })
      return {
        code: edit.semantics?.error_code,
        ranges: edit.semantics?.candidate_line_ranges,
        contextRanges: edit.semantics?.candidate_contexts?.map((context) => context.line_range),
        recoverable: edit.semantics?.recoverable,
        resultStatus: edit.status,
      }
    `)
    assert.equal(result.status, 'success')
    assert.match(result.summary, /recoverable edit conflict/u)
    assert.equal(result.toolCalls[0]?.status, 'error')
    assert.deepEqual(result.output, {
      code: 'TARGET_AMBIGUOUS',
      ranges: ['1-1', '2-2'],
      contextRanges: ['1-1', '2-2'],
      recoverable: true,
      resultStatus: 'error',
    })
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), originalContent)
    await bundle.codeModeExecutor.dispose()
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('model-facing Code Mode keeps recoverable edit conflicts non-fatal', async () => {
  const originalContent = 'const item = 1\nconst item = 1\n'
  const fixture = await createFixture(originalContent)
  try {
    const bundle = await createInternalEditCompatibilityBundle(fixture.workspaceRootPath)
    const codeMode = bundle.tools.code_mode as unknown as {
      execute: (input: unknown, options: { abortSignal?: AbortSignal }) => Promise<{
        body: string
        semantics?: { tool_calls?: Array<{ semantics?: Record<string, unknown>; status?: string }> }
        status: string
      }>
    }
    const result = await codeMode.execute({
      source: "return await tools.edit({ path: 'target.ts', edits: [{ targetContent: 'const item = 1', replacementContent: 'const item = 2' }] })",
    }, {})

    assert.equal(result.status, 'success')
    assert.match(result.body, /recoverable edit conflict/u)
    assert.equal(result.semantics?.tool_calls?.[0]?.status, 'error')
    assert.equal(result.semantics?.tool_calls?.[0]?.semantics?.recoverable, true)
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), originalContent)
    await bundle.codeModeExecutor?.dispose()
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode Promise.all preserves recoverable edit conflicts while other edits complete', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-recoverable-parallel-edit-'))
  try {
    await fs.writeFile(path.join(workspaceRootPath, 'first.ts'), 'const repeated = 1\nconst repeated = 1\n', 'utf8')
    await fs.writeFile(path.join(workspaceRootPath, 'second.ts'), 'const repeated = 2\nconst repeated = 2\n', 'utf8')
    await fs.writeFile(path.join(workspaceRootPath, 'third.ts'), 'const unique = 3\n', 'utf8')

    const bundle = await createInternalEditCompatibilityBundle(workspaceRootPath)
    assert.ok(bundle.codeModeExecutor)
    const result = await bundle.codeModeExecutor.run(`
      const results = await Promise.all([
        tools.edit({ path: 'first.ts', edits: [{ targetContent: 'const repeated = 1', replacementContent: 'const repeated = 10' }] }),
        tools.edit({ path: 'second.ts', edits: [{ targetContent: 'const repeated = 2', replacementContent: 'const repeated = 20' }] }),
        tools.edit({ path: 'third.ts', edits: [{ targetContent: 'const unique = 3', replacementContent: 'const unique = 30' }] }),
      ])
      return results.map((edit) => ({
        code: edit.semantics?.error_code ?? null,
        contextCount: edit.semantics?.candidate_contexts?.length ?? 0,
        recoverable: edit.semantics?.recoverable === true,
        status: edit.status,
      }))
    `)

    assert.equal(result.status, 'success')
    assert.match(result.summary, /2 recoverable edit conflicts/u)
    assert.equal(result.toolCalls.length, 3)
    assert.deepEqual(result.output, [
      { code: 'TARGET_AMBIGUOUS', contextCount: 2, recoverable: true, status: 'error' },
      { code: 'TARGET_AMBIGUOUS', contextCount: 2, recoverable: true, status: 'error' },
      { code: null, contextCount: 0, recoverable: false, status: 'success' },
    ])
    assert.equal(result.toolCalls.filter((call) => call.status === 'error').length, 2)
    assert.equal(await fs.readFile(path.join(workspaceRootPath, 'first.ts'), 'utf8'), 'const repeated = 1\nconst repeated = 1\n')
    assert.equal(await fs.readFile(path.join(workspaceRootPath, 'second.ts'), 'utf8'), 'const repeated = 2\nconst repeated = 2\n')
    assert.equal(await fs.readFile(path.join(workspaceRootPath, 'third.ts'), 'utf8'), 'const unique = 30\n')
    await bundle.codeModeExecutor.dispose()
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode coalesces concurrent same-file edits against one source snapshot', async () => {
  const originalContent = 'header\nkeep\ntarget\ntail\n'
  const fixture = await createFixture(originalContent)
  try {
    const bundle = await createInternalEditCompatibilityBundle(fixture.workspaceRootPath)
    assert.ok(bundle.codeModeExecutor)
    const result = await bundle.codeModeExecutor.run(`
      const results = await Promise.all([
        tools.edit({
          path: 'target.ts',
          edits: [{ insertAt: 'start', insertContent: 'prefix\\n' }],
        }),
        tools.edit({
          path: 'target.ts',
          edits: [{
            targetContent: 'target',
            replacementContent: 'changed',
            startLine: 3,
            endLine: 3,
          }],
        }),
      ])
      return results.map((edit) => ({ operation: edit.semantics?.operation, status: edit.status }))
    `)

    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, [
      { operation: 'edit', status: 'success' },
      { operation: 'edit', status: 'success' },
    ])
    assert.equal(result.toolCalls.length, 1)
    const mergedArguments = result.toolCalls[0]?.arguments as { edits?: unknown[] } | undefined
    assert.equal(mergedArguments?.edits?.length, 2)
    assert.equal(
      await fs.readFile(fixture.targetPath, 'utf8'),
      'prefix\nheader\nkeep\nchanged\ntail\n',
    )
    await bundle.codeModeExecutor.dispose()
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode canonicalizes the reported targetContent plus replacement shape', async () => {
  const originalContent = "export const states = [\n  'blocked',\n]\n"
  const fixture = await createFixture(originalContent)
  try {
    const bundle = await createInternalEditCompatibilityBundle(fixture.workspaceRootPath)
    assert.ok(bundle.codeModeExecutor)
    const result = await bundle.codeModeExecutor.run(`
      return await tools.edit({
        path: 'target.ts',
        edits: [{ targetContent: "  'blocked',", replacement: "  'resolved'," }],
      })
    `)

    assert.equal(result.status, 'success')
    assert.equal(
      await fs.readFile(fixture.targetPath, 'utf8'),
      "export const states = [\n  'resolved',\n]\n",
    )
    await bundle.codeModeExecutor.dispose()
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode supports the semantic text, range, and insertion edit forms', async () => {
  const fixture = await createFixture('alpha\nbeta\ngamma\n')
  try {
    const bundle = await createInternalEditCompatibilityBundle(fixture.workspaceRootPath)
    assert.ok(bundle.codeModeExecutor)
    const result = await bundle.codeModeExecutor.run(`
      return await tools.edit({
        path: 'target.ts',
        edits: [
          { target: 'alpha', replacement: 'ALPHA' },
          { startLine: 2, endLine: 2, replacement: 'BETA\\n' },
          { insertAt: 'end', content: 'tail\\n' },
        ],
      })
    `)

    assert.equal(result.status, 'success')
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), 'ALPHA\nBETA\ngamma\ntail\n')
    await bundle.codeModeExecutor.dispose()
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode exposes the semantic edit contract instead of native edit field names', async () => {
  const fixture = await createFixture('const value = 1\n')
  try {
    const bundle = await createInternalEditCompatibilityBundle(fixture.workspaceRootPath)
    const editEntry = bundle.registry.get('edit')
    assert.ok(editEntry)
    const editProperties = editEntry.inputSchema.properties as Record<string, unknown> | undefined
    const editsSchema = editProperties?.edits as { items?: { properties?: Record<string, unknown> } } | undefined
    const hunkProperties = editsSchema?.items?.properties
    assert.ok(hunkProperties)
    for (const publicField of ['target', 'replacement', 'startLine', 'endLine', 'replaceAll', 'insertAt', 'content']) {
      assert.ok(publicField in hunkProperties)
    }
    for (const nativeField of ['targetContent', 'replacementContent', 'insertContent']) {
      assert.ok(!(nativeField in hunkProperties))
    }
    assert.match(editEntry.description, /\{ target, replacement \}/u)

    const codeModeDescription = (bundle.tools.code_mode as { description?: string }).description ?? ''
    assert.match(codeModeDescription, /\{ target, replacement \}/u)
    assert.match(codeModeDescription, /\{ startLine, endLine, replacement \}/u)
    assert.match(codeModeDescription, /\{ insertAt, content \}/u)
    assert.doesNotMatch(codeModeDescription, /targetContent|replacementContent|insertContent/u)
    await bundle.codeModeExecutor?.dispose()
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode repairs legacy edit aliases and duplicated hunk paths before validation', async () => {
  const originalContent = 'const value = 1\n'
  const fixture = await createFixture(originalContent)
  try {
    const bundle = await createInternalEditCompatibilityBundle(fixture.workspaceRootPath)
    const codeMode = bundle.tools.code_mode as unknown as {
      execute: (input: unknown, options: { abortSignal?: AbortSignal }) => Promise<{ status: string }>
    }
    const result = await codeMode.execute({
      source: "return await tools.edit({ path: 'target.ts', edits: [{ path: 'target.ts', oldText: 'const value = 1', newText: 'const value = 2' }] })",
    }, {})
    assert.equal(result.status, 'success')
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), 'const value = 2\n')
    await bundle.codeModeExecutor?.dispose()
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode accepts equivalent edit aliases without guessing between conflicting values', async () => {
  const fixture = await createFixture('const value = 1\n')
  try {
    const bundle = await createInternalEditCompatibilityBundle(fixture.workspaceRootPath)
    const codeMode = bundle.tools.code_mode as unknown as {
      execute: (input: unknown, options: { abortSignal?: AbortSignal }) => Promise<{ status: string }>
    }
    const result = await codeMode.execute({
      source: "return await tools.edit({ path: 'target.ts', edits: [{ target: 'const value = 1', targetContent: 'const value = 1', replacement: 'const value = 2', replacementContent: 'const value = 2' }] })",
    }, {})

    assert.equal(result.status, 'success')
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), 'const value = 2\n')
    await bundle.codeModeExecutor?.dispose()
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode leaves conflicting edit aliases and mismatched hunk paths invalid', async () => {
  const originalContent = 'const value = 1\n'
  const fixture = await createFixture(originalContent)
  try {
    const bundle = await createInternalEditCompatibilityBundle(fixture.workspaceRootPath)
    const codeMode = bundle.tools.code_mode as unknown as {
      execute: (input: unknown, options: { abortSignal?: AbortSignal }) => Promise<{ status: string }>
    }
    const invalidPrograms = [
      "return await tools.edit({ path: 'target.ts', edits: [{ targetContent: 'const value = 1', oldText: 'const other = 1', replacementContent: 'const value = 2' }] })",
      "return await tools.edit({ path: 'target.ts', edits: [{ targetContent: 'const value = 1', target: 'const other = 1', replacement: 'const value = 2' }] })",
      "return await tools.edit({ path: 'target.ts', edits: [{ path: 'other.ts', oldText: 'const value = 1', newText: 'const value = 2' }] })",
      "return await tools.edit({ path: 'target.ts', edits: [{ startLine: 1, lineStart: 2, endLine: 1, replacementContent: '' }] })",
      "return await tools.edit({ path: 'target.ts', edits: [{ startLine: 1, replacementContent: '' }] })",
      "return await tools.edit({ path: 'target.ts', edits: [{ startLine: 1, endLine: 1, replacementContent: '', replaceAll: true }] })",
      "return await tools.edit({ path: 'target.ts', edits: [{ insertAt: 'end', insertContent: 'x', targetContent: 'const value = 1', replacementContent: 'const value = 2' }] })",
    ]

    for (const code of invalidPrograms) {
      const result = await codeMode.execute({ source: code }, {})
      assert.equal(result.status, 'error')
      assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), originalContent)
    }
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
