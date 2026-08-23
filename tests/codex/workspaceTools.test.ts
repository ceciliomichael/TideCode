import assert from 'node:assert/strict'
import { asSchema } from 'ai'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createNativeAgentTools as createAgentTools } from '../../electron/chat/shared/tools'
import {
  createGlobToolResult,
  createGrepToolResult,
  createListToolResult,
  createReadToolResult,
  createWholeFileWriteToolResult,
  resolveReadableTargetPath,
  resolveReadOnlyTargetPath,
} from '../../electron/chat/shared/tools/workspaceTools'
import { getGlobalAgentsDirectory } from '../../electron/chat/shared/tools/sandboxPaths'
import { createCanonicalToolModelOutput } from '../../electron/chat/shared/toolReplay'

interface ExecutableToolResult {
  body?: string
  status: string
  summary?: string
  subject?: {
    path?: string
  }
}

test('read tool returns image files as numbered multimodal model content', async () => {
  const fixturePath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-read-image-'))
  const imagePath = path.join(fixturePath, 'pixel.png')
  const imageBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  )
  await fs.writeFile(imagePath, imageBytes)

  try {
    const result = await createReadToolResult(imagePath, 'pixel.png', undefined, undefined)
    assert.equal(result.status, 'success')
    assert.equal(result.body, undefined)
    assert.deepEqual(result.resultPresentation, {
      fileName: 'pixel.png',
      kind: 'image',
      mediaType: 'image/png',
      relativePath: 'pixel.png',
    })

    const modelOutput = createCanonicalToolModelOutput({
      argumentsValue: { path: 'pixel.png' },
      output: result,
      toolCallId: 'read-image-1',
      toolName: 'read',
    })
    assert.equal(modelOutput.type, 'content')
    if (modelOutput.type !== 'content') return
    assert.deepEqual(modelOutput.value[0], {
      text: '[Image #1]\nFile: pixel.png',
      type: 'text',
    })
    assert.equal(modelOutput.value[1]?.type, 'file')
    assert.equal(modelOutput.value[1]?.mediaType, 'image/png')
  } finally {
    await fs.rm(fixturePath, { force: true, recursive: true })
  }
})

interface ExecutableReadTool {
  execute: (input: { full_file?: boolean; limit?: number; offset?: number; path: string }) => Promise<ExecutableToolResult>
}

interface ExecutableListTool {
  execute: (input: { path?: string }) => Promise<ExecutableToolResult>
}

interface ExecutableGlobTool {
  execute: (input: { path?: string; pattern: string }) => Promise<ExecutableToolResult>
}

interface ExecutableGrepTool {
  execute: (input: { include?: string; path?: string; pattern: string }) => Promise<ExecutableToolResult>
}

interface ExecutableWriteTool {
  execute: (input: { content: string; path: string }) => Promise<ExecutableToolResult>
}

interface ExecutableEditTool {
  execute: (input: { edits: Array<{ replacementContent: string; targetContent: string }>; path: string }) => Promise<ExecutableToolResult>
}

async function createWorkspaceFixture() {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-workspace-tools-'))

  await fs.mkdir(path.join(workspaceRootPath, 'src'), { recursive: true })
  await fs.mkdir(path.join(workspaceRootPath, 'nested', 'package-a', 'src'), { recursive: true })
  await fs.mkdir(path.join(workspaceRootPath, 'ignored', 'nested'), { recursive: true })
  await fs.mkdir(path.join(workspaceRootPath, '.git', 'objects'), { recursive: true })
  await fs.mkdir(path.join(workspaceRootPath, 'node_modules', 'pkg'), { recursive: true })
  await fs.writeFile(
    path.join(workspaceRootPath, '.gitignore'),
    'ignored/\nnode_modules/\n*.secret\n.env\n',
    'utf8',
  )
  await fs.writeFile(path.join(workspaceRootPath, 'nested', 'package-a', '.gitignore'), 'src/generated.ts\n', 'utf8')
  await fs.writeFile(
    path.join(workspaceRootPath, 'src', 'visible.ts'),
    'export const visible = "needle"\nconst clearMpinValue = clearMpin(\n',
    'utf8',
  )
  await fs.writeFile(
    path.join(workspaceRootPath, 'nested', 'package-a', 'src', 'generated.ts'),
    'export const generated = "needle"\n',
    'utf8',
  )
  await fs.writeFile(
    path.join(workspaceRootPath, 'nested', 'package-a', 'src', 'kept.ts'),
    'export const kept = "needle"\n',
    'utf8',
  )
  await fs.writeFile(path.join(workspaceRootPath, 'src', 'listable.ts'), 'export const listable = "list"\n', 'utf8')
  await fs.writeFile(path.join(workspaceRootPath, 'notes.md'), 'This note mentions list and needle.\n', 'utf8')
  await fs.writeFile(path.join(workspaceRootPath, 'ignored', 'hidden.ts'), 'export const hidden = "needle"\n', 'utf8')
  await fs.writeFile(path.join(workspaceRootPath, 'ignored', 'nested', 'deep.ts'), 'export const deep = "needle"\n', 'utf8')
  await fs.writeFile(path.join(workspaceRootPath, '.git', 'config'), 'needle\n', 'utf8')
  await fs.writeFile(path.join(workspaceRootPath, 'plain.secret'), 'needle\n', 'utf8')
  await fs.writeFile(path.join(workspaceRootPath, '.env'), 'SECRET=needle\n', 'utf8')
  await fs.writeFile(path.join(workspaceRootPath, 'node_modules', 'pkg', 'index.ts'), 'export const dependency = "needle"\n', 'utf8')

  return workspaceRootPath
}

test('public workspace tools treat empty read and search paths as the canonical root', async () => {
  const workspaceRootPath = await createWorkspaceFixture()

  try {
    const tools = await createAgentTools(
      { workspaceRootPath },
      { chatMode: 'agent' },
    )
    const read = tools.read as unknown as ExecutableReadTool
    const list = tools.list as unknown as ExecutableListTool
    const glob = tools.glob as unknown as ExecutableGlobTool
    const grep = tools.grep as unknown as ExecutableGrepTool

    const [readEmpty, readDot] = await Promise.all([read.execute({ path: '' }), read.execute({ path: '.' })])
    const [listEmpty, listDot, listOmitted] = await Promise.all([list.execute({ path: '' }), list.execute({ path: '.' }), list.execute({})])
    const [globEmpty, globDot, globOmitted] = await Promise.all([
      glob.execute({ path: '', pattern: '**/*.ts' }),
      glob.execute({ path: '.', pattern: '**/*.ts' }),
      glob.execute({ pattern: '**/*.ts' }),
    ])
    const [grepEmpty, grepDot, grepOmitted] = await Promise.all([
      grep.execute({ path: '', pattern: 'needle' }),
      grep.execute({ path: '.', pattern: 'needle' }),
      grep.execute({ pattern: 'needle' }),
    ])

    for (const result of [readEmpty, listEmpty, globEmpty, grepEmpty]) {
      assert.equal(result.status, 'success')
      assert.equal(result.subject?.path, '.')
    }
    assert.equal(readEmpty.body, readDot.body)
    assert.equal(listEmpty.body, listDot.body)
    assert.equal(listEmpty.body, listOmitted.body)
    assert.deepEqual(globEmpty.body.split('\n').sort(), globDot.body.split('\n').sort())
    assert.deepEqual(globEmpty.body.split('\n').sort(), globOmitted.body.split('\n').sort())
    assert.equal(grepEmpty.body, grepDot.body)
    assert.equal(grepEmpty.body, grepOmitted.body)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('public workspace tools keep empty mutation targets and workspace selection invalid', async () => {
  const workspaceRootPath = await createWorkspaceFixture()

  try {
    const tools = await createAgentTools(
      { workspaceRootPath },
      { chatMode: 'agent' },
    )
    const write = tools.write as unknown as ExecutableWriteTool
    const edit = tools.edit as unknown as ExecutableEditTool

    const writeResult = await write.execute({ content: 'unsafe', path: '' })
    assert.equal(writeResult.status, 'error')
    assert.match(writeResult.summary ?? '', /path.*required/iu)
    const editResult = await edit.execute({ edits: [{ replacementContent: 'y', targetContent: 'x' }], path: '' })
    assert.equal(editResult.status, 'error')
    assert.match(editResult.summary ?? '', /non-empty "path"/u)
    await assert.rejects(
      createAgentTools({ workspaceRootPath: '' }, { chatMode: 'agent' }),
      /Workspace root path is required/u,
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createListToolResult lists only immediate visible directory entries at the requested path', async () => {
  const workspaceRootPath = await createWorkspaceFixture()

  try {
    const result = await createListToolResult(workspaceRootPath, workspaceRootPath, '.')

    assert.equal(result.status, 'success')
    assert.match(result.body ?? '', /^src\/$/mu)
    assert.match(result.body ?? '', /\.env/u)
    assert.doesNotMatch(result.body ?? '', /ignored/u)
    assert.doesNotMatch(result.body ?? '', /plain\.secret/u)
    assert.doesNotMatch(result.body ?? '', /node_modules/u)
    assert.doesNotMatch(result.body ?? '', /visible\.ts/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createListToolResult reports empty directories explicitly', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const emptyDirectoryPath = path.join(workspaceRootPath, 'empty')
  await fs.mkdir(emptyDirectoryPath)

  try {
    const result = await createListToolResult(workspaceRootPath, emptyDirectoryPath, 'empty')

    assert.equal(result.status, 'success')
    assert.equal(result.body, 'Empty directory')
    assert.equal(result.summary, 'Empty directory')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('list, glob, and grep expose clean continuation metadata instead of truncation flags', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const pageDirectoryPath = path.join(workspaceRootPath, 'pages')
  await fs.mkdir(pageDirectoryPath)
  await Promise.all(Array.from({ length: 120 }, async (_value, index) => {
    await fs.writeFile(
      path.join(pageDirectoryPath, `item-${String(index).padStart(3, '0')}.ts`),
      `export const item${index} = 'paged-needle'\n`,
      'utf8',
    )
  }))

  try {
    const listResult = await createListToolResult(workspaceRootPath, pageDirectoryPath, 'pages', 100, 20)
    const globResult = await createGlobToolResult(workspaceRootPath, pageDirectoryPath, 'pages', '**/*.ts', 100, 20)
    const grepResult = await createGrepToolResult(
      workspaceRootPath,
      pageDirectoryPath,
      'pages',
      'paged-needle',
      '**/*.ts',
      100,
      20,
    )

    for (const result of [listResult, globResult, grepResult]) {
      assert.equal(result.status, 'success')
      assert.equal(result.truncated, undefined)
      assert.equal(result.semantics?.total_count, 120)
      assert.equal(result.semantics?.returned_count, 20)
      assert.equal(result.semantics?.offset, 100)
      assert.equal(result.semantics?.has_more, false)
      assert.equal(result.semantics?.next_offset, null)
      assert.doesNotMatch(result.body ?? '', /truncat|showing .* of|omitted/iu)
    }
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('read keeps synthetic EOF metadata out of model source content', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const filePath = path.join(workspaceRootPath, 'notes.md')

  try {
    const result = await createReadToolResult(filePath, 'notes.md', undefined, undefined)

    assert.equal(result.status, 'success')
    assert.equal(result.body, 'This note mentions list and needle.')
    assert.doesNotMatch(result.body ?? '', /End of file/u)
    assert.equal(result.displayBody, 'This note mentions list and needle.')
    const { revision, ...readSemantics } = result.semantics ?? {}
    assert.match(String(revision), /^sha256:[a-f0-9]{64}$/u)
    assert.deepEqual(readSemantics, {
      end_line: 1,
      has_more: false,
      is_directory: false,
      next_offset: null,
      returned_line_count: 1,
      start_line: 1,
      total_line_count: 1,
    })
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('read defaults to 500 lines and permits a full-file opt-in', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const filePath = path.join(workspaceRootPath, 'large.txt')
  const lines = Array.from({ length: 750 }, (_, index) => `${index + 1}:${'x'.repeat(100)}`)
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8')

  try {
    const initialResult = await createReadToolResult(filePath, 'large.txt', undefined, undefined)
    const offsetResult = await createReadToolResult(filePath, 'large.txt', 251, undefined)

    assert.equal(initialResult.status, 'success')
    assert.equal(initialResult.truncated, undefined)
    assert.match(initialResult.body ?? '', /^1:/u)
    assert.match(initialResult.body ?? '', /500:x{100}$/u)
    assert.doesNotMatch(initialResult.body ?? '', /501:x{100}/u)
    assert.equal(initialResult.semantics?.end_line, 500)
    assert.equal(initialResult.semantics?.total_line_count, 750)
    assert.equal(initialResult.semantics?.has_more, true)
    assert.equal(initialResult.semantics?.next_offset, 501)

    assert.equal(offsetResult.status, 'success')
    assert.equal(offsetResult.truncated, undefined)
    assert.match(offsetResult.body ?? '', /^251:/u)
    assert.match(offsetResult.body ?? '', /750:x{100}$/u)
    assert.equal(offsetResult.semantics?.start_line, 251)
    assert.equal(offsetResult.semantics?.end_line, 750)
    assert.equal(offsetResult.semantics?.total_line_count, 750)
    assert.equal(offsetResult.semantics?.has_more, false)
    assert.equal(offsetResult.semantics?.next_offset, null)

    const fullFileResult = await createReadToolResult(filePath, 'large.txt', 501, 10, true)
    assert.equal(fullFileResult.status, 'success')
    assert.equal(fullFileResult.semantics?.start_line, 1)
    assert.equal(fullFileResult.semantics?.end_line, 750)
    assert.equal(fullFileResult.semantics?.total_line_count, 750)
    assert.equal(fullFileResult.semantics?.has_more, false)
    assert.equal(fullFileResult.semantics?.next_offset, null)
    assert.match(fullFileResult.body ?? '', /750:x{100}$/u)

  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('list rejects a file path with an actionable type error', async () => {
  const workspaceRootPath = await createWorkspaceFixture()

  try {
    await assert.rejects(
      createListToolResult(workspaceRootPath, path.join(workspaceRootPath, 'notes.md'), 'notes.md'),
      /Expected a directory for list.*Use read for the file/u,
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('explicitly targeted gitignored directories expose their nested contents', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const ignoredDirectoryPath = path.join(workspaceRootPath, 'ignored')

  try {
    const listResult = await createListToolResult(workspaceRootPath, ignoredDirectoryPath, 'ignored')
    const globResult = await createGlobToolResult(workspaceRootPath, ignoredDirectoryPath, 'ignored', '**/*.ts')
    const grepResult = await createGrepToolResult(workspaceRootPath, ignoredDirectoryPath, 'ignored', 'needle', '**/*.ts')

    assert.match(listResult.body ?? '', /nested\/$/mu)
    assert.match(globResult.body ?? '', /hidden\.ts/u)
    assert.match(globResult.body ?? '', /deep\.ts/u)
    assert.match(grepResult.body ?? '', /deep\.ts/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createGlobToolResult excludes matches from gitignored directories, even when searching inside an ignored subtree', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const ignoredDirectoryPath = path.join(workspaceRootPath, 'ignored')

  try {
    const workspaceResult = await createGlobToolResult(workspaceRootPath, workspaceRootPath, '.', '**/*.ts')
    const ignoredResult = await createGlobToolResult(workspaceRootPath, ignoredDirectoryPath, 'ignored', '**/*.ts')

    assert.equal(workspaceResult.status, 'success')
    assert.match(workspaceResult.body ?? '', /visible\.ts/u)
    assert.doesNotMatch(workspaceResult.body ?? '', /hidden\.ts/u)
    assert.doesNotMatch(workspaceResult.body ?? '', /node_modules/u)

    assert.equal(ignoredResult.status, 'success')
    assert.match(ignoredResult.body ?? '', /hidden\.ts/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createGlobToolResult respects nested .gitignore files anywhere in the workspace tree', async () => {
  const workspaceRootPath = await createWorkspaceFixture()

  try {
    const result = await createGlobToolResult(workspaceRootPath, workspaceRootPath, '.', '**/*.ts')

    assert.equal(result.status, 'success')
    assert.match(result.body ?? '', /nested[\\/]package-a[\\/]src[\\/]kept\.ts/u)
    assert.doesNotMatch(result.body ?? '', /nested[\\/]package-a[\\/]src[\\/]generated\.ts/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createGlobToolResult excludes .git metadata even for broad git-like filename patterns', async () => {
  const workspaceRootPath = await createWorkspaceFixture()

  try {
    const result = await createGlobToolResult(workspaceRootPath, workspaceRootPath, '.', '**/*git*')

    assert.equal(result.status, 'success')
    assert.match(result.body ?? '', /\.gitignore/u)
    assert.doesNotMatch(result.body ?? '', /[\\/]?\.git[\\/]+config/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createGrepToolResult returns the ripgrep-style workspace match set', async () => {
  const workspaceRootPath = await createWorkspaceFixture()

  try {
    const result = await createGrepToolResult(workspaceRootPath, workspaceRootPath, '.', 'needle', '**/{*,.*}')

    assert.equal(result.status, 'success')
    assert.equal(result.semantics?.total_count, 3)
    assert.match(result.body ?? '', /visible\.ts/u)
    assert.match(result.body ?? '', /notes\.md/u)
    assert.match(result.body ?? '', /nested[\\/]package-a[\\/]src[\\/]kept\.ts/u)
    assert.doesNotMatch(result.body ?? '', /node_modules[\\/]+pkg[\\/]+index\.ts/u)
    assert.doesNotMatch(result.body ?? '', /ignored[\\/]+hidden\.ts/u)
    assert.doesNotMatch(result.body ?? '', /plain\.secret/u)
    assert.doesNotMatch(result.body ?? '', /\.env/u)
    assert.doesNotMatch(result.body ?? '', /[\\/]?\.git[\\/]+config/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createWholeFileWriteToolResult counts content changes without counting line-ending changes', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-write-diff-tools-'))
  const targetPath = path.join(workspaceRootPath, 'target.ts')

  try {
    await fs.writeFile(targetPath, 'first\r\nsecond\r\nthird\r\n', 'utf8')

    const result = await createWholeFileWriteToolResult(
      {
        checkpointId: null,
        terminalExecutionMode: 'sandbox',
        workspaceRootPath,
      },
      {
        content: 'first\r\nupdated\r\nthird\r\n',
        path: 'target.ts',
      },
    )

    assert.equal(result.status, 'success')
    assert.match(result.body ?? '', /M target\.ts \(\+1 -1\)/u)
    assert.equal(result.resultPresentation?.kind, 'change_diff')
    assert.equal(result.resultPresentation?.changes[0]?.addedLineCount, 1)
    assert.equal(result.resultPresentation?.changes[0]?.removedLineCount, 1)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createGrepToolResult supports searching a specific file path', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const filePath = path.join(workspaceRootPath, 'src', 'visible.ts')

  try {
    const result = await createGrepToolResult(workspaceRootPath, filePath, path.join('src', 'visible.ts'), 'needle', '**/*.ts')

    assert.equal(result.status, 'success')
    assert.equal(result.subject?.kind, 'file')
    assert.equal(result.semantics?.total_count, 1)
    assert.match(result.body ?? '', /src[\\/]+visible\.ts/u)
    assert.doesNotMatch(result.body ?? '', /notes\.md/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createGrepToolResult sorts matches by file path and line number', async () => {
  const workspaceRootPath = await createWorkspaceFixture()

  try {
    const alphaFilePath = path.join(workspaceRootPath, 'src', 'alpha.ts')
    const betaFilePath = path.join(workspaceRootPath, 'src', 'beta.ts')
    await fs.writeFile(alphaFilePath, 'export const alpha = "needle"\n', 'utf8')
    await fs.writeFile(betaFilePath, 'export const beta = "needle"\n', 'utf8')

    const result = await createGrepToolResult(workspaceRootPath, workspaceRootPath, '.', 'needle', '**/*.ts')

    assert.equal(result.status, 'success')
    const body = result.body ?? ''
    assert.ok(body.indexOf(alphaFilePath) !== -1)
    assert.ok(body.indexOf(betaFilePath) !== -1)
    assert.ok(body.indexOf(alphaFilePath) < body.indexOf(betaFilePath))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createGrepToolResult returns no files for a missing pattern', async () => {
  const workspaceRootPath = await createWorkspaceFixture()

  try {
    const result = await createGrepToolResult(workspaceRootPath, workspaceRootPath, '.', 'does-not-exist', undefined)

    assert.equal(result.status, 'success')
    assert.equal(result.body, 'No files found')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createGrepToolResult returns no files for invalid regex patterns', async () => {
  const workspaceRootPath = await createWorkspaceFixture()

  try {
    const result = await createGrepToolResult(workspaceRootPath, workspaceRootPath, '.', 'clearMpin(', undefined)

    assert.equal(result.status, 'success')
    assert.equal(result.body, 'No files found')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createListToolResult shows contents of a workspace-ignored directory like node_modules when explicitly targeted', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const nodeModulesPath = path.join(workspaceRootPath, 'node_modules')

  try {
    const result = await createListToolResult(workspaceRootPath, nodeModulesPath, 'node_modules')

    assert.equal(result.status, 'success')
    assert.match(result.body ?? '', /pkg\/$/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createGlobToolResult finds files inside node_modules when explicitly targeting it', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const nodeModulesPath = path.join(workspaceRootPath, 'node_modules')

  try {
    const result = await createGlobToolResult(workspaceRootPath, nodeModulesPath, 'node_modules', '**/*.ts')

    assert.equal(result.status, 'success')
    assert.match(result.body ?? '', /node_modules[\\/]pkg[\\/]index\.ts/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createGrepToolResult finds matches inside node_modules when explicitly targeting it', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const nodeModulesPath = path.join(workspaceRootPath, 'node_modules')

  try {
    const result = await createGrepToolResult(
      workspaceRootPath,
      nodeModulesPath,
      'node_modules',
      'needle',
      '**/*.ts',
    )

    assert.equal(result.status, 'success')
    assert.equal(result.semantics?.total_count, 1)
    assert.match(result.body ?? '', /node_modules[\\/]pkg[\\/]index\.ts/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createGlobToolResult still hides node_modules from root-level searches', async () => {
  const workspaceRootPath = await createWorkspaceFixture()

  try {
    const result = await createGlobToolResult(workspaceRootPath, workspaceRootPath, '.', '**/*.ts')

    assert.equal(result.status, 'success')
    assert.doesNotMatch(result.body ?? '', /node_modules/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createGrepToolResult still hides node_modules from root-level searches', async () => {
  const workspaceRootPath = await createWorkspaceFixture()

  try {
    const result = await createGrepToolResult(workspaceRootPath, workspaceRootPath, '.', 'needle', '**/{*,.*}')

    assert.equal(result.status, 'success')
    assert.doesNotMatch(result.body ?? '', /node_modules/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('resolveReadableTargetPath keeps sandbox reads inside the workspace', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const outsideFilePath = path.join(tmpdir(), `tidecode-outside-${Date.now()}.txt`)

  try {
    await fs.writeFile(outsideFilePath, 'outside workspace\n', 'utf8')

    assert.throws(
      () => resolveReadableTargetPath(workspaceRootPath, outsideFilePath, 'sandbox'),
      /outside the workspace root/u,
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
    await fs.rm(outsideFilePath, { force: true })
  }
})

test('read-only workspace resolution explains duplicated workspace roots', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const duplicatedWorkspaceRootPath = path.join(workspaceRootPath, path.basename(workspaceRootPath))

  try {
    await assert.rejects(
      resolveReadOnlyTargetPath(workspaceRootPath, duplicatedWorkspaceRootPath, 'sandbox'),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal(error.message, 'Invalid path: workspace root repeated. Use a path relative to the workspace root.')
        return true
      },
    )

    assert.throws(
      () => resolveReadableTargetPath(workspaceRootPath, path.join(duplicatedWorkspaceRootPath, 'src', 'new.ts'), 'sandbox'),
      /Invalid path: workspace root repeated/u,
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('read-only workspace resolution explains that path strings cannot contain multiple roots', async () => {
  const workspaceRootPath = await createWorkspaceFixture()

  try {
    await assert.rejects(
      resolveReadOnlyTargetPath(workspaceRootPath, 'src electron', 'sandbox'),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal(
          error.message,
          'Path not found: src electron. Use a path relative to the workspace root. Do not guess a replacement filename; discover the actual path with list, glob, or grep from a known directory. The path field accepts one path only; if you meant multiple roots, use one call per root instead of joining them with spaces.',
        )
        return true
      },
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('resolveReadableTargetPath allows sandbox reads in global .agents but rejects sibling directories', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const globalAgentsDirectory = getGlobalAgentsDirectory()
  const skillResourcePath = path.join(globalAgentsDirectory, 'skills', 'documents', 'references', 'formatting.md')
  const siblingPath = path.join(path.dirname(globalAgentsDirectory), '.agents-backup', 'secrets.txt')

  try {
    const target = resolveReadableTargetPath(
      workspaceRootPath,
      skillResourcePath,
      'sandbox',
      { allowGlobalAgentsDirectory: true },
    )
    assert.equal(target.absolutePath, path.resolve(skillResourcePath))
    assert.equal(target.displayPath, path.resolve(skillResourcePath))

    assert.throws(
      () => resolveReadableTargetPath(
        workspaceRootPath,
        siblingPath,
        'sandbox',
        { allowGlobalAgentsDirectory: true },
      ),
      /outside the sandbox roots/u,
    )
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('sandbox list, glob, and grep can inspect global .agents skill files', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const globalAgentsDirectory = getGlobalAgentsDirectory()
  const agentsDirectoryExisted = await fs.stat(globalAgentsDirectory)
    .then((stats) => stats.isDirectory())
    .catch(() => false)
  await fs.mkdir(globalAgentsDirectory, { recursive: true })
  const skillDirectory = await fs.mkdtemp(path.join(globalAgentsDirectory, 'tidecode-readonly-tools-'))
  const scriptsDirectory = path.join(skillDirectory, 'scripts')
  const scriptPath = path.join(scriptsDirectory, 'validate.mjs')

  try {
    await fs.mkdir(scriptsDirectory, { recursive: true })
    await fs.writeFile(scriptPath, 'console.log("skill-validation-needle")\n', 'utf8')
    await fs.writeFile(path.join(skillDirectory, 'SKILL.md'), '# Test skill\n', 'utf8')

    const tools = await createAgentTools(
      { workspaceRootPath },
      { chatMode: 'agent' },
    )
    const listResult = await (tools.list as unknown as ExecutableListTool).execute({
      path: skillDirectory,
    })
    const globResult = await (tools.glob as unknown as ExecutableGlobTool).execute({
      path: skillDirectory,
      pattern: '**/*.mjs',
    })
    const grepResult = await (tools.grep as unknown as ExecutableGrepTool).execute({
      path: skillDirectory,
      pattern: 'skill-validation-needle',
    })

    assert.equal(listResult.status, 'success')
    assert.match(listResult.body ?? '', /scripts\//u)
    assert.equal(globResult.status, 'success')
    assert.match(globResult.body ?? '', /validate\.mjs/u)
    assert.equal(grepResult.status, 'success')
    assert.match(grepResult.body ?? '', /skill-validation-needle/u)
  } finally {
    await fs.rm(skillDirectory, { force: true, recursive: true })
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
    if (!agentsDirectoryExisted) {
      await fs.rmdir(globalAgentsDirectory).catch(() => undefined)
    }
  }
})

test('sandbox list rejects directories outside the workspace and global .agents', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const outsideDirectoryPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-sandbox-list-outside-'))

  try {
    const tools = await createAgentTools(
      { workspaceRootPath },
      { chatMode: 'agent' },
    )
    const result = await (tools.list as unknown as ExecutableListTool).execute({
      path: outsideDirectoryPath,
    })

    assert.equal(result.status, 'error')
    assert.match(result.summary ?? '', /outside the sandbox roots/u)
  } finally {
    await fs.rm(outsideDirectoryPath, { force: true, recursive: true })
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('sandbox write remains blocked inside global .agents', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const globalSkillFilePath = path.join(
    getGlobalAgentsDirectory(),
    'skills',
    'protected-skill',
    'SKILL.md',
  )

  try {
    const tools = await createAgentTools(
      { workspaceRootPath },
      { chatMode: 'agent' },
    )
    const writeResult = await (tools.write as unknown as ExecutableWriteTool).execute({
      path: globalSkillFilePath,
      content: '# Changed skill\n',
    })
    assert.equal(writeResult.status, 'error')
    assert.match(writeResult.summary ?? '', /outside the workspace root/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('resolveReadableTargetPath allows Full Access reads outside the workspace and createReadToolResult can read them', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const outsideFilePath = path.join(tmpdir(), `tidecode-outside-${Date.now()}.txt`)

  try {
    await fs.writeFile(outsideFilePath, 'outside workspace\n', 'utf8')

    const target = resolveReadableTargetPath(workspaceRootPath, outsideFilePath, 'full')
    assert.equal(target.absolutePath, outsideFilePath)
    assert.equal(target.displayPath, outsideFilePath)

    const result = await createReadToolResult(target.absolutePath, target.displayPath, 1, 10)

    assert.equal(result.status, 'success')
    assert.match(result.body ?? '', /outside workspace/u)
assert.match(String(result.semantics?.revision), /^sha256:[a-f0-9]{64}$/u)
    assert.equal(result.subject?.path, outsideFilePath)
    assert.match(result.summary, /Read /u)
    assert.match(result.summary, new RegExp(`${outsideFilePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
    await fs.rm(outsideFilePath, { force: true })
  }
})

test('createAgentTools list allows explicit external directories in Full Access mode', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const outsideDirectoryPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-outside-list-'))
  const outsideFileName = 'external-marker.txt'

  try {
    await fs.writeFile(path.join(outsideDirectoryPath, outsideFileName), 'outside directory\n', 'utf8')

    const tools = await createAgentTools(
      {
        terminalExecutionMode: 'full',
        workspaceRootPath,
      },
      { chatMode: 'plan' },
    )
    const result = await (tools.list as unknown as ExecutableListTool).execute({
      path: outsideDirectoryPath,
    })

    assert.equal(result.status, 'success')
    assert.equal(result.subject?.path, outsideDirectoryPath)
    assert.match(result.body ?? '', new RegExp(`^${outsideFileName}$`, 'mu'))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
    await fs.rm(outsideDirectoryPath, { force: true, recursive: true })
  }
})

test('workspace tool schemas use path consistently for filesystem targets', async () => {
  const workspaceRootPath = await createWorkspaceFixture()

  try {
    const tools = await createAgentTools(
      { workspaceRootPath },
      { chatMode: 'agent' },
    )

    for (const toolName of ['list', 'read', 'glob', 'grep', 'edit', 'write']) {
      const tool = tools[toolName] as { description?: string; inputSchema: unknown }
      const schema = await asSchema(tool.inputSchema).jsonSchema as {
        properties?: Record<string, { description?: string }>
      }
      assert.ok(schema.properties && 'path' in schema.properties, `${toolName} should expose path`)
      if (['list', 'read', 'glob', 'grep'].includes(toolName)) {
        assert.match(tool.description ?? '', /empty string/u)
        assert.match(schema.properties?.path?.description ?? '', /empty string/u)
      } else {
        assert.doesNotMatch(tool.description ?? '', /empty string/u)
        assert.doesNotMatch(schema.properties?.path?.description ?? '', /empty string/u)
      }
    }

    const editSchemaTool = tools.edit as { inputSchema: unknown }
    const editSchema = await asSchema(editSchemaTool.inputSchema).jsonSchema as {
      properties?: Record<string, {
        items?: { properties?: Record<string, unknown> }
      }>
    }
    assert.ok(editSchema.properties && 'path' in editSchema.properties)
    assert.ok(editSchema.properties && 'edits' in editSchema.properties)
    assert.ok(editSchema.properties && 'expectedRevision' in editSchema.properties)
    assert.ok(editSchema.properties?.edits?.items?.properties && 'replaceAll' in editSchema.properties.edits.items.properties)

    const writeSchemaTool = tools.write as { inputSchema: unknown }
    const writeSchema = await asSchema(writeSchemaTool.inputSchema).jsonSchema as {
      properties?: Record<string, unknown>
    }
    assert.ok(writeSchema.properties && 'expectedRevision' in writeSchema.properties)
    assert.equal(tools.patch, undefined)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('list, glob, and grep hide AGENTS.md files from AI tool results', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const nestedDirectoryPath = path.join(workspaceRootPath, 'nested', 'package-a')

  try {
    await fs.writeFile(path.join(workspaceRootPath, 'AGENTS.md'), 'rootAgentInstructionNeedle\n', 'utf8')
    await fs.writeFile(path.join(nestedDirectoryPath, 'agents.md'), 'nestedAgentInstructionNeedle\n', 'utf8')

    const listResult = await createListToolResult(workspaceRootPath, workspaceRootPath, '.')
    const globResult = await createGlobToolResult(workspaceRootPath, workspaceRootPath, '.', '**/*.md')
    const grepResult = await createGrepToolResult(
      workspaceRootPath,
      workspaceRootPath,
      '.',
      'AgentInstructionNeedle',
      '**/*',
    )

    assert.equal(listResult.status, 'success')
    assert.doesNotMatch(listResult.body ?? '', /AGENTS\.md/u)
    assert.equal(globResult.status, 'success')
    assert.doesNotMatch(globResult.body ?? '', /AGENTS\.md/u)
    assert.doesNotMatch(globResult.body ?? '', /agents\.md/u)
    assert.equal(grepResult.status, 'success')
    assert.equal(grepResult.body, 'No files found')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools glob and grep allow explicit external paths in Full Access mode', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const outsideDirectoryPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-outside-search-'))
  const outsideFileName = 'external-search.ts'
  const outsideFilePath = path.join(outsideDirectoryPath, outsideFileName)

  try {
    await fs.writeFile(outsideFilePath, 'export const externalNeedle = "needle"\n', 'utf8')

    const tools = await createAgentTools(
      {
        terminalExecutionMode: 'full',
        workspaceRootPath,
      },
      { chatMode: 'plan' },
    )

    const globResult = await (tools.glob as unknown as ExecutableGlobTool).execute({
      path: outsideDirectoryPath,
      pattern: '**/*.ts',
    })
    const grepResult = await (tools.grep as unknown as ExecutableGrepTool).execute({
      path: outsideDirectoryPath,
      include: '**/*.ts',
      pattern: 'externalNeedle',
    })

    assert.equal(globResult.status, 'success')
    assert.equal(globResult.subject?.path, outsideDirectoryPath)
    assert.match(globResult.body ?? '', new RegExp(outsideFileName, 'u'))

    assert.equal(grepResult.status, 'success')
    assert.equal(grepResult.subject?.path, outsideDirectoryPath)
    assert.match(grepResult.body ?? '', /externalNeedle/u)
    assert.match(grepResult.body ?? '', new RegExp(outsideFileName, 'u'))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
    await fs.rm(outsideDirectoryPath, { force: true, recursive: true })
  }
})

test('createAgentTools write allows explicit external files in Full Access mode', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const outsideDirectoryPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-outside-write-'))
  const outsideFilePath = path.join(outsideDirectoryPath, 'external-write.txt')

  try {
    const tools = await createAgentTools(
      {
        terminalExecutionMode: 'full',
        workspaceRootPath,
      },
      { chatMode: 'agent' },
    )

    const writeResult = await (tools.write as unknown as ExecutableWriteTool).execute({
      path: outsideFilePath,
      content: 'written\n',
    })

    assert.equal(writeResult.status, 'success')
    assert.equal(await fs.readFile(outsideFilePath, 'utf8'), 'written\n')

    assert.equal(await fs.readFile(outsideFilePath, 'utf8'), 'written\n')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
    await fs.rm(outsideDirectoryPath, { force: true, recursive: true })
  }
})

test('createAgentTools write reports identical file content as a successful no-op', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const targetFilePath = path.join(workspaceRootPath, 'src', 'same-write.ts')
  await fs.writeFile(targetFilePath, 'export const value = 1\n', 'utf8')

  try {
    const tools = await createAgentTools(
      {
        workspaceRootPath,
      },
      { chatMode: 'agent' },
    )

    const result = await (tools.write as unknown as ExecutableWriteTool).execute({
      path: targetFilePath,
      content: 'export const value = 1\n',
    })

    assert.equal(result.status, 'success')
    assert.match(result.summary ?? '', /Skipped unchanged write/u)
    assert.equal(await fs.readFile(targetFilePath, 'utf8'), 'export const value = 1\n')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools write preserves requested line endings for new files', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const targetFilePath = path.join(workspaceRootPath, 'src', 'line-endings.ts')

  try {
    const tools = await createAgentTools(
      {
        workspaceRootPath,
      },
      { chatMode: 'agent' },
    )

    const result = await (tools.write as unknown as ExecutableWriteTool).execute({
      path: targetFilePath,
      content: 'export const first = 1\r\nexport const second = 2\r\n',
    })

    assert.equal(result.status, 'success')
assert.equal(await fs.readFile(targetFilePath, 'utf8'), 'export const first = 1\r\nexport const second = 2\r\n')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools write treats line-ending-only rewrites as a no-op and preserves existing format', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const targetFilePath = path.join(workspaceRootPath, 'src', 'line-ending-only.ts')
  await fs.writeFile(targetFilePath, 'export const value = 1\r\n', 'utf8')

  try {
    const tools = await createAgentTools(
      {
        workspaceRootPath,
      },
      { chatMode: 'agent' },
    )

    const result = await (tools.write as unknown as ExecutableWriteTool).execute({
      path: targetFilePath,
      content: 'export const value = 1\n',
    })

    assert.equal(result.status, 'success')
    assert.match(result.summary ?? '', /Skipped unchanged write/u)
    assert.equal(await fs.readFile(targetFilePath, 'utf8'), 'export const value = 1\r\n')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
