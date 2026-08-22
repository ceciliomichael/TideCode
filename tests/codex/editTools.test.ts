import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createEditToolResult,
  type EditOperationInput,
  type WorkspaceToolContext,
} from '../../electron/chat/shared/tools/workspaceTools'
import { createReadTool } from '../../electron/chat/shared/tools/readTool'

async function createFixture(content: string) {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-replace-tools-'))
  const targetPath = path.join(workspaceRootPath, 'target.ts')
  await fs.writeFile(targetPath, content, 'utf8')

  const context: WorkspaceToolContext = {
    checkpointId: null,
    terminalExecutionMode: 'sandbox',
    workspaceRootPath,
  }

  return { context, targetPath, workspaceRootPath }
}

async function createSingleEditToolResult(
  context: WorkspaceToolContext,
  input: { path: string } & Partial<EditOperationInput>,
) {
  const { path: editPath, ...edit } = input
  return createEditToolResult(context, {
    edits: [edit as EditOperationInput],
    path: editPath,
  })
}

test('replace supports relative path in path parameter', async () => {
  const originalContent = 'const val = 1\n'
  const fixture = await createFixture(originalContent)
  try {
    const result = await createSingleEditToolResult(fixture.context, {
      path: 'target.ts',
      allowMultiple: false,
      endLine: 1,
      replacementContent: 'const val = 2',
      startLine: 1,
      targetContent: 'const val = 1',
    })
    assert.equal(result.status, 'success')
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), 'const val = 2\n')
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('edit rejects missing files instead of creating them', async () => {
  const fixture = await createFixture('const value = true\n')
  const createdPath = path.join(fixture.workspaceRootPath, 'src', 'blocks.js')

  try {
    await assert.rejects(
      createSingleEditToolResult(fixture.context, {
        endLine: 1,
        allowMultiple: false,
        path: 'src/blocks.js',
        replacementContent: 'export const blocks = []\n',
        startLine: 1,
        targetContent: 'new file',
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal((error as { code?: string }).code, 'FILE_NOT_FOUND')
        assert.match(error.message, /Use write to create new files/u)
        return true
      },
    )
    await assert.rejects(fs.stat(createdPath), /ENOENT/u)
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('edit finds a unique target with line bounds', async () => {
  const fixture = await createFixture('const value = true\n')

  try {
    const result = await createSingleEditToolResult(fixture.context, {
      allowMultiple: false,
      endLine: 1,
      path: fixture.targetPath,
      replacementContent: 'const value = false',
      startLine: 1,
      targetContent: 'const value = true',
    })

    assert.equal(result.status, 'success')
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), 'const value = false\n')
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('edit applies multiple hunks atomically within one file', async () => {
  const originalContent = [
    'const first = true',
    'const keep = 1',
    'const last = false',
    '',
  ].join('\n')
  const fixture = await createFixture(originalContent)

  try {
    const result = await createEditToolResult(fixture.context, {
      edits: [
        {
          allowMultiple: false,
          endLine: 1,
          replacementContent: 'const first = false',
          startLine: 1,
          targetContent: 'const first = true',
        },
        {
          allowMultiple: false,
          endLine: 3,
          replacementContent: 'const last = true',
          startLine: 3,
          targetContent: 'const last = false',
        },
      ],
      path: fixture.targetPath,
    })

    assert.equal(result.status, 'success')
    assert.match(result.summary, /2 blocks/u)
    assert.equal(
      await fs.readFile(fixture.targetPath, 'utf8'),
      [
        'const first = false',
        'const keep = 1',
        'const last = true',
        '',
      ].join('\n'),
    )
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('edit applies no multi-hunk changes when any hunk fails', async () => {
  const originalContent = 'const first = true\nconst keep = 1\n'
  const fixture = await createFixture(originalContent)

  try {
    await assert.rejects(
      createEditToolResult(fixture.context, {
        edits: [
          {
            allowMultiple: false,
            endLine: 1,
            replacementContent: 'const first = false',
            startLine: 1,
            targetContent: 'const first = true',
          },
          {
            allowMultiple: false,
            endLine: 2,
            replacementContent: 'const missing = true',
            startLine: 2,
            targetContent: 'const missing = false',
          },
        ],
        path: fixture.targetPath,
      }),
      /Target content not found between lines 2 and 2/u,
    )
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), originalContent)
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('edit reports an identical replacement as a successful no-op', async () => {
  const originalContent = 'const value = true\n'
  const fixture = await createFixture(originalContent)

  try {
    const result = await createSingleEditToolResult(fixture.context, {
      allowMultiple: false,
      endLine: 1,
      path: fixture.targetPath,
      replacementContent: 'const value = true',
      startLine: 1,
      targetContent: 'const value = true',
    })

    assert.equal(result.status, 'success')
    assert.equal(result.semantics?.operation, 'noop')
    assert.equal(result.semantics?.reason, 'replacement_identical_to_target')
    assert.match(result.summary, /Skipped unchanged edit/u)
    assert.match(result.body ?? '', /No changes were made/u)
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), originalContent)
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('edit rejects ambiguous targets by default instead of replacing every occurrence', async () => {
  const originalContent = 'const item = "old"\nconst middle = 1\nconst item = "old"\n'
  const fixture = await createFixture(originalContent)

  try {
    await assert.rejects(
      createSingleEditToolResult(fixture.context, {
        path: fixture.targetPath,
        replacementContent: 'const item = "new"',
        targetContent: 'const item = "old"',
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal((error as { code?: string }).code, 'TARGET_AMBIGUOUS')
        assert.match(error.message, /Candidate line ranges: 1-1, 3-3/u)
        return true
      },
    )
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), originalContent)
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('edit filters out identical context anchor hunks when active edits exist', async () => {
  const originalContent = 'const a = 1\nconst b = 2\nconst c = 3\n'
  const fixture = await createFixture(originalContent)

  try {
    const result = await createEditToolResult(fixture.context, {
      edits: [
        {
          replacementContent: 'const a = 1',
          targetContent: 'const a = 1',
        },
        {
          replacementContent: 'const b = 20',
          targetContent: 'const b = 2',
        },
      ],
      path: fixture.targetPath,
    })

    assert.equal(result.status, 'success')
    assert.equal(
      await fs.readFile(fixture.targetPath, 'utf8'),
      'const a = 1\nconst b = 20\nconst c = 3\n',
    )
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('edit enforces single-match when replaceAll: false is explicitly set', async () => {
  const originalContent = 'const value = true\nconst middle = 1\nconst value = true\n'
  const fixture = await createFixture(originalContent)

  try {
    await assert.rejects(
      createSingleEditToolResult(fixture.context, {
        replaceAll: false,
        path: fixture.targetPath,
        replacementContent: 'const value = false',
        targetContent: 'const value = true',
      }),
      /Candidate line ranges: 1-1, 3-3/u,
    )
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), originalContent)
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('replaceAll searches entire file when line bounds are omitted', async () => {
  const originalContent = [
    'const snippet = "old"',
    'const middle = true',
    'const snippet = "old"',
    'const tail = true',
    '',
  ].join('\n')
  const fixture = await createFixture(originalContent)

  try {
    const readTool = createReadTool(fixture.context) as unknown as {
      execute: (input: { limit: number; offset: number; path: string }) => Promise<{ status: string }>
    }
    const readResult = await readTool.execute({
      limit: 2,
      offset: 1,
      path: 'target.ts',
    })
    assert.equal(readResult.status, 'success')

    const result = await createSingleEditToolResult(fixture.context, {
      path: fixture.targetPath,
      replaceAll: true,
      replacementContent: 'const snippet = "new"',
      targetContent: 'const snippet = "old"',
    })

    assert.equal(result.status, 'success')
    assert.equal(
      await fs.readFile(fixture.targetPath, 'utf8'),
      [
        'const snippet = "new"',
        'const middle = true',
        'const snippet = "new"',
        'const tail = true',
        '',
      ].join('\n'),
    )
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('edit requires both line bounds together', async () => {
  const fixture = await createFixture('const value = true\n')

  try {
    await assert.rejects(
      createSingleEditToolResult(fixture.context, {
        allowMultiple: false,
        path: fixture.targetPath,
        replacementContent: 'const value = false',
        startLine: 1,
        targetContent: 'const value = true',
      }),
      /must provide both startLine and endLine/u,
    )
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('replace serializes concurrent same-file tool calls without dropping changes', async () => {
  const originalContent = ['export const first = 1', 'export const middle = true', 'export const last = 3', ''].join('\n')
  const fixture = await createFixture(originalContent)
  try {
    const [res1, res2] = await Promise.all([
      createSingleEditToolResult(fixture.context, {
        path: 'target.ts',
        allowMultiple: false,
        endLine: 1,
        replacementContent: 'export const first = 100',
        startLine: 1,
        targetContent: 'export const first = 1',
      }),
      createSingleEditToolResult(fixture.context, {
        path: 'target.ts',
        allowMultiple: false,
        endLine: 3,
        replacementContent: 'export const last = 300',
        startLine: 3,
        targetContent: 'export const last = 3',
      }),
    ])
    assert.equal(res1.status, 'success')
    assert.equal(res2.status, 'success')
    assert.equal(
      await fs.readFile(fixture.targetPath, 'utf8'),
      ['export const first = 100', 'export const middle = true', 'export const last = 300', ''].join('\n'),
    )
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('replace tolerates indentation differences while preserving exact line text', async () => {
  const originalContent = '  const value = true\n'
  const fixture = await createFixture(originalContent)

  try {
    const result = await createSingleEditToolResult(fixture.context, {
      path: fixture.targetPath,
      allowMultiple: false,
      endLine: 1,
      replacementContent: 'const value = false',
      startLine: 1,
      targetContent: '\tconst value = true',
    })

    assert.equal(result.status, 'success')
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), 'const value = false\n')
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('replace tolerates indentation and terminal newline differences', async () => {
  const originalContent = [
    '<section>',
    '  const value = true',
    '</section>',
    '',
  ].join('\n')
  const fixture = await createFixture(originalContent)

  try {
    const result = await createSingleEditToolResult(fixture.context, {
      allowMultiple: false,
      path: fixture.targetPath,
      replacementContent: '  const value = false',
      startLine: 2,
      endLine: 2,
      targetContent: '\tconst value = true\n',
    })

    assert.equal(result.status, 'success')
    assert.equal(
      await fs.readFile(fixture.targetPath, 'utf8'),
      [
        '<section>',
        '  const value = false',
        '</section>',
        '',
      ].join('\n'),
    )
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('replace tolerates model-copied indentation with a terminal newline', async () => {
  const originalContent = [
    '<div>',
    '                  style={{ minWidth: `${gutterWidthCh}ch` }}',
    '  >',
    '',
  ].join('\n')
  const fixture = await createFixture(originalContent)

  try {
    const result = await createSingleEditToolResult(fixture.context, {
      allowMultiple: false,
      endLine: 2,
      path: fixture.targetPath,
      replacementContent: '                  style={{ width: `${gutterWidthCh}ch` }}\n',
      startLine: 2,
      targetContent: '                   style={{ minWidth: `${gutterWidthCh}ch` }}\n',
    })

    assert.equal(result.status, 'success')
    assert.equal(
      await fs.readFile(fixture.targetPath, 'utf8'),
      [
        '<div>',
        '                  style={{ width: `${gutterWidthCh}ch` }}',
        '  >',
        '',
      ].join('\n'),
    )
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('replace tolerates indentation differences across a multi-line block', async () => {
  const originalContent = [
    'function render() {',
    '            return (',
    '              value',
    '            )',
    '}',
    '',
  ].join('\n')
  const fixture = await createFixture(originalContent)

  try {
    const result = await createSingleEditToolResult(fixture.context, {
      path: 'target.ts',
      allowMultiple: false,
      endLine: 4,
      replacementContent: [
        'function render() {',
        '            return (',
        '              nextValue',
        '            )',
      ].join('\n'),
      startLine: 1,
      targetContent: [
        'function render() {',
        '          return (',
        '            value',
        '          )',
      ].join('\n'),
    })

    assert.equal(result.status, 'success')
    assert.equal(
      await fs.readFile(fixture.targetPath, 'utf8'),
      [
        'function render() {',
        '            return (',
        '              nextValue',
        '            )',
        '}',
        '',
      ].join('\n'),
    )
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('replace treats a supplied line range as an authoritative boundary', async () => {
  const originalContent = [
    'const first = true',
    'const inserted = true',
    'const target = false',
    '',
  ].join('\n')
  const fixture = await createFixture(originalContent)

  try {
    await assert.rejects(
      createSingleEditToolResult(fixture.context, {
        path: fixture.targetPath,
        allowMultiple: false,
        endLine: 1,
        replacementContent: 'const target = true',
        startLine: 1,
        targetContent: 'const target = false',
      }),
      /Target content not found between lines 1 and 1/u,
    )
    assert.equal(
      await fs.readFile(fixture.targetPath, 'utf8'),
      [
        'const first = true',
        'const inserted = true',
        'const target = false',
        '',
      ].join('\n'),
    )
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('replace reports candidate line ranges for an ambiguous ranged target', async () => {
  const originalContent = [
    'const repeated = false',
    'const middle = true',
    'const repeated = false',
    '',
  ].join('\n')
  const fixture = await createFixture(originalContent)

  try {
    await assert.rejects(
      createSingleEditToolResult(fixture.context, {
        path: fixture.targetPath,
        allowMultiple: false,
        endLine: 3,
        replacementContent: 'const repeated = true',
        startLine: 1,
        targetContent: 'const repeated = false',
      }),
      /Target content found 2 times between lines 1 and 3/u,
    )

    assert.equal(
      await fs.readFile(fixture.targetPath, 'utf8'),
      originalContent,
    )
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})
