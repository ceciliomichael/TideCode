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
test('replace resolves back-to-back parallel tool calls targeting different regions', async () => {
  const originalContent = ['export const first = 1', 'export const middle = true', 'export const last = 3', ''].join('\n')
  const fixture = await createFixture(originalContent)
  try {
    const res1 = await createEditToolResult(fixture.context, {
      path: 'target.ts',
      allowMultiple: false,
      endLine: 1,
      replacementContent: 'export const first = 100',
      startLine: 1,
      targetContent: 'export const first = 1',
    })
    const res2 = await createEditToolResult(fixture.context, {
      path: 'target.ts',
      allowMultiple: false,
      endLine: 3,
      replacementContent: 'export const last = 300',
      startLine: 3,
      targetContent: 'export const last = 3',
    })
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
