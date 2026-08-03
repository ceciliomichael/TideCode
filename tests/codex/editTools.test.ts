import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createEditToolResult,
  type WorkspaceToolContext,
} from '../../electron/chat/shared/tools/workspaceTools'

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

test('replace supports relative path in path parameter', async () => {
  const originalContent = 'const val = 1\n'
  const fixture = await createFixture(originalContent)
  try {
    const result = await createEditToolResult(fixture.context, {
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

test('edit creates a missing file from its replacement content', async () => {
  const fixture = await createFixture('const value = true\n')
  const createdPath = path.join(fixture.workspaceRootPath, 'src', 'blocks.js')

  try {
    const result = await createEditToolResult(fixture.context, {
      allowMultiple: false,
      path: 'src/blocks.js',
      replacementContent: 'export const blocks = []\n',
      targetContent: 'new file',
    })

    assert.equal(result.status, 'success')
    assert.match(result.body ?? '', /A .*blocks\.js/u)
    assert.equal(await fs.readFile(createdPath, 'utf8'), 'export const blocks = []\n')
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('edit finds a unique target without line bounds', async () => {
  const fixture = await createFixture('const value = true\n')

  try {
    const result = await createEditToolResult(fixture.context, {
      allowMultiple: false,
      path: fixture.targetPath,
      replacementContent: 'const value = false',
      targetContent: 'const value = true',
    })

    assert.equal(result.status, 'success')
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), 'const value = false\n')
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('edit applies multiple independent blocks atomically', async () => {
  const originalContent = 'const first = true\nconst second = true\n'
  const fixture = await createFixture(originalContent)

  try {
    const result = await createEditToolResult(fixture.context, {
      edits: [
        {
          allowMultiple: false,
          replacementContent: 'const first = false',
          targetContent: 'const first = true',
        },
        {
          allowMultiple: false,
          replacementContent: 'const second = false',
          targetContent: 'const second = true',
        },
      ],
      path: fixture.targetPath,
    })

    assert.equal(result.status, 'success')
    assert.equal(
      await fs.readFile(fixture.targetPath, 'utf8'),
      'const first = false\nconst second = false\n',
    )
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('edit keeps a batch atomic when one target is missing', async () => {
  const originalContent = 'const first = true\nconst second = true\n'
  const fixture = await createFixture(originalContent)

  try {
    await assert.rejects(
      createEditToolResult(fixture.context, {
        edits: [
          {
            allowMultiple: false,
            replacementContent: 'const first = false',
            targetContent: 'const first = true',
          },
          {
            allowMultiple: false,
            replacementContent: 'const missing = false',
            targetContent: 'const missing = true',
          },
        ],
        path: fixture.targetPath,
      }),
      /Target content not found/u,
    )
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), originalContent)
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('edit rejects ambiguous targets without line bounds', async () => {
  const originalContent = 'const value = true\nconst middle = 1\nconst value = true\n'
  const fixture = await createFixture(originalContent)

  try {
    await assert.rejects(
      createEditToolResult(fixture.context, {
        allowMultiple: false,
        path: fixture.targetPath,
        replacementContent: 'const value = false',
        targetContent: 'const value = true',
      }),
      /Read the file and use a line range that contains one match/u,
    )
    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), originalContent)
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('edit requires line bounds together when either bound is provided', async () => {
  const fixture = await createFixture('const value = true\n')

  try {
    await assert.rejects(
      createEditToolResult(fixture.context, {
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
      createEditToolResult(fixture.context, {
        path: 'target.ts',
        allowMultiple: false,
        endLine: 1,
        replacementContent: 'export const first = 100',
        startLine: 1,
        targetContent: 'export const first = 1',
      }),
      createEditToolResult(fixture.context, {
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
    const result = await createEditToolResult(fixture.context, {
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
    const result = await createEditToolResult(fixture.context, {
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

test('replace finds one exact target when its old line numbers are stale', async () => {
  const originalContent = [
    'const first = true',
    'const inserted = true',
    'const target = false',
    '',
  ].join('\n')
  const fixture = await createFixture(originalContent)

  try {
    const result = await createEditToolResult(fixture.context, {
      path: fixture.targetPath,
      allowMultiple: false,
      endLine: 1,
      replacementContent: 'const target = true',
      startLine: 1,
      targetContent: 'const target = false',
    })

    assert.equal(result.status, 'success')
    assert.equal(
      await fs.readFile(fixture.targetPath, 'utf8'),
      [
        'const first = true',
        'const inserted = true',
        'const target = true',
        '',
      ].join('\n'),
    )
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('replace does not guess when stale lines leave multiple exact matches', async () => {
  const originalContent = [
    'const repeated = false',
    'const middle = true',
    'const repeated = false',
    '',
  ].join('\n')
  const fixture = await createFixture(originalContent)

  try {
    await assert.rejects(
      createEditToolResult(fixture.context, {
        path: fixture.targetPath,
        allowMultiple: false,
        endLine: 2,
        replacementContent: 'const repeated = true',
        startLine: 2,
        targetContent: 'const repeated = false',
      }),
      /Target content found 2 times/u,
    )

    assert.equal(
      await fs.readFile(fixture.targetPath, 'utf8'),
      originalContent,
    )
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})
