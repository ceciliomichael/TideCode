import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createMultiReplaceFileContentToolResult,
  createReplaceFileContentToolResult,
  type WorkspaceToolContext,
} from '../../electron/chat/shared/tools/workspaceTools'

async function createFixture(content: string) {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-replace-tools-'))
  const targetPath = path.join(workspaceRootPath, 'target.ts')
  await fs.writeFile(targetPath, content, 'utf8')

  const context: WorkspaceToolContext = {
    checkpointId: null,
    terminalExecutionMode: 'sandbox',
    workspaceRootPath,
  }

  return { context, targetPath, workspaceRootPath }
}

test('multi-replace applies non-contiguous edits against one file snapshot', async () => {
  const fixture = await createFixture(
    ['export const first = 1', 'export const middle = true', 'export const last = 3', ''].join('\n'),
  )

  try {
    const result = await createMultiReplaceFileContentToolResult(fixture.context, {
      absolute_path: fixture.targetPath,
      chunks: [
        {
          allowMultiple: false,
          endLine: 1,
          replacementContent: 'export const first = 100',
          startLine: 1,
          targetContent: 'export const first = 1',
        },
        {
          allowMultiple: false,
          endLine: 3,
          replacementContent: 'export const last = 300',
          startLine: 3,
          targetContent: 'export const last = 3',
        },
      ],
    })

    assert.equal(result.status, 'success')
    assert.equal(
      await fs.readFile(fixture.targetPath, 'utf8'),
      ['export const first = 100', 'export const middle = true', 'export const last = 300', ''].join('\n'),
    )
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('multi-replace leaves the file unchanged when any chunk is invalid', async () => {
  const originalContent = ['export const first = 1', 'export const last = 3', ''].join('\n')
  const fixture = await createFixture(originalContent)

  try {
    await assert.rejects(
      createMultiReplaceFileContentToolResult(fixture.context, {
        absolute_path: fixture.targetPath,
        chunks: [
          {
            allowMultiple: false,
            endLine: 1,
            replacementContent: 'export const first = 100',
            startLine: 1,
            targetContent: 'export const first = 1',
          },
          {
            allowMultiple: false,
            endLine: 2,
            replacementContent: 'export const missing = true',
            startLine: 2,
            targetContent: 'export const missing = false',
          },
        ],
      }),
      /Multi-replace validation failed.*Target content not found/su,
    )

    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), originalContent)
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('multi-replace rejects overlapping targets without writing', async () => {
  const originalContent = 'alpha beta gamma\n'
  const fixture = await createFixture(originalContent)

  try {
    await assert.rejects(
      createMultiReplaceFileContentToolResult(fixture.context, {
        absolute_path: fixture.targetPath,
        chunks: [
          {
            allowMultiple: false,
            endLine: 1,
            replacementContent: 'first',
            startLine: 1,
            targetContent: 'alpha beta',
          },
          {
            allowMultiple: false,
            endLine: 1,
            replacementContent: 'second',
            startLine: 1,
            targetContent: 'beta gamma',
          },
        ],
      }),
      /Replacement chunks 1 and 2 overlap/u,
    )

    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), originalContent)
  } finally {
    await fs.rm(fixture.workspaceRootPath, { force: true, recursive: true })
  }
})

test('replace requires exact whitespace instead of guessing a match', async () => {
  const originalContent = '  const value = true\n'
  const fixture = await createFixture(originalContent)

  try {
    await assert.rejects(
      createReplaceFileContentToolResult(fixture.context, {
        absolute_path: fixture.targetPath,
        allowMultiple: false,
        endLine: 1,
        replacementContent: 'const value = false',
        startLine: 1,
        targetContent: '\tconst value = true',
      }),
      /Target content not found/u,
    )

    assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), originalContent)
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
    const result = await createReplaceFileContentToolResult(fixture.context, {
      absolute_path: fixture.targetPath,
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
      createReplaceFileContentToolResult(fixture.context, {
        absolute_path: fixture.targetPath,
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
