import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createAgentToolBundle, createNativeAgentTools } from '../../electron/chat/shared/tools'
import {
  createEditToolResult,
  createReadToolResult,
  createWholeFileWriteToolResult,
  type WorkspaceToolContext,
} from '../../electron/chat/shared/tools/workspaceTools'

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

function requireRevision(result: Awaited<ReturnType<typeof createReadToolResult>>) {
  const revision = result.semantics?.revision
  assert.equal(typeof revision, 'string')
  assert.match(revision as string, /^sha256:[a-f0-9]{64}$/u)
  return revision as string
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
    const readResult = await createReadToolResult(fixture.targetPath, 'target.ts', 1, 20)
    const revision = requireRevision(readResult)
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
    const readResult = await createReadToolResult(fixture.targetPath, 'target.ts', 1, 20)
    const revision = requireRevision(readResult)
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
    const readResult = await createReadToolResult(fixture.targetPath, 'target.ts', 1, 20)
    const revision = requireRevision(readResult)
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
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), originalContent)
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode sidecar payloads preserve arbitrary nested source text for write and edit', async () => {
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

    const writeResult = await codeMode.execute({
      code: "return await tools.write({ path: 'nested-source.txt', content: payloads.source })",
      payloads: { source: rawSource },
    }, {})
    assert.equal(writeResult.status, 'success')
    assert.equal(await fs.readFile(path.join(workspaceRootPath, 'nested-source.txt'), 'utf8'), rawSource)

    const replacement = rawSource.replace('export const nested = true', 'export const nested = false')
    const editResult = await codeMode.execute({
      code: "return await tools.edit({ path: 'nested-source.txt', edits: [{ targetContent: payloads.target, replacementContent: payloads.replacement }] })",
      payloads: { replacement, target: rawSource },
    }, {})
    assert.equal(editResult.status, 'success')
    assert.equal(await fs.readFile(path.join(workspaceRootPath, 'nested-source.txt'), 'utf8'), replacement)
    await bundle.codeModeExecutor?.dispose()
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
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
