import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createAgentTools } from '../../electron/chat/shared/tools'
import {
  createApplyPatchToolResult,
  createGlobToolResult,
  createGrepToolResult,
  createListToolResult,
  createReadToolResult,
  resolveReadableTargetPath,
} from '../../electron/chat/shared/tools/workspaceTools'

interface ExecutableToolResult {
  body?: string
  status: string
  summary?: string
  subject?: {
    path?: string
  }
}

interface ExecutableListTool {
  execute: (input: { absolute_path: string }) => Promise<ExecutableToolResult>
}

interface ExecutableGlobTool {
  execute: (input: { absolute_path: string; pattern: string }) => Promise<ExecutableToolResult>
}

interface ExecutableGrepTool {
  execute: (input: { absolute_path: string; include?: string; pattern: string }) => Promise<ExecutableToolResult>
}

interface ExecutableWriteTool {
  execute: (input: { absolute_path: string; content: string }) => Promise<ExecutableToolResult>
}

interface ExecutableReplaceTool {
  execute: (input: {
    absolute_path: string
    endLine: number
    replacementContent: string
    startLine: number
    targetContent: string
  }) => Promise<ExecutableToolResult>
}

async function createWorkspaceFixture() {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-workspace-tools-'))

  await fs.mkdir(path.join(workspaceRootPath, 'src'), { recursive: true })
  await fs.mkdir(path.join(workspaceRootPath, 'nested', 'package-a', 'src'), { recursive: true })
  await fs.mkdir(path.join(workspaceRootPath, 'ignored'), { recursive: true })
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
  await fs.writeFile(path.join(workspaceRootPath, '.git', 'config'), 'needle\n', 'utf8')
  await fs.writeFile(path.join(workspaceRootPath, 'plain.secret'), 'needle\n', 'utf8')
  await fs.writeFile(path.join(workspaceRootPath, '.env'), 'SECRET=needle\n', 'utf8')
  await fs.writeFile(path.join(workspaceRootPath, 'node_modules', 'pkg', 'index.ts'), 'export const dependency = "needle"\n', 'utf8')

  return workspaceRootPath
}

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
    assert.equal(ignoredResult.body, 'No files found')
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
    assert.equal(result.semantics?.matches, 3)
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

test('createGrepToolResult supports searching a specific file path', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const filePath = path.join(workspaceRootPath, 'src', 'visible.ts')

  try {
    const result = await createGrepToolResult(workspaceRootPath, filePath, path.join('src', 'visible.ts'), 'needle', '**/*.ts')

    assert.equal(result.status, 'success')
    assert.equal(result.subject?.kind, 'file')
    assert.equal(result.semantics?.matches, 1)
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
    assert.equal(result.semantics?.matches, 1)
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
  const outsideFilePath = path.join(tmpdir(), `echosphere-outside-${Date.now()}.txt`)

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

test('resolveReadableTargetPath allows Full Access reads outside the workspace and createReadToolResult can read them', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const outsideFilePath = path.join(tmpdir(), `echosphere-outside-${Date.now()}.txt`)

  try {
    await fs.writeFile(outsideFilePath, 'outside workspace\n', 'utf8')

    const target = resolveReadableTargetPath(workspaceRootPath, outsideFilePath, 'full')
    assert.equal(target.absolutePath, outsideFilePath)
    assert.equal(target.displayPath, outsideFilePath)

    const result = await createReadToolResult(target.absolutePath, target.displayPath, 1, 10)

    assert.equal(result.status, 'success')
    assert.match(result.body ?? '', /outside workspace/u)
    assert.equal(result.semantics?.revision, undefined)
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
  const outsideDirectoryPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-outside-list-'))
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
      absolute_path: outsideDirectoryPath,
    })

    assert.equal(result.status, 'success')
    assert.equal(result.subject?.path, outsideDirectoryPath)
    assert.match(result.body ?? '', new RegExp(`^${outsideFileName}$`, 'mu'))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
    await fs.rm(outsideDirectoryPath, { force: true, recursive: true })
  }
})

test('createAgentTools glob and grep allow explicit external paths in Full Access mode', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const outsideDirectoryPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-outside-search-'))
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
      absolute_path: outsideDirectoryPath,
      pattern: '**/*.ts',
    })
    const grepResult = await (tools.grep as unknown as ExecutableGrepTool).execute({
      absolute_path: outsideDirectoryPath,
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

test('createAgentTools write and replace allow explicit external files in Full Access mode', async () => {
  const workspaceRootPath = await createWorkspaceFixture()
  const outsideDirectoryPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-outside-write-'))
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
      absolute_path: outsideFilePath,
      content: 'written\n',
    })

    assert.equal(writeResult.status, 'success')
    assert.equal(await fs.readFile(outsideFilePath, 'utf8'), 'written\n')

    const replaceResult = await (tools.replace_file_content as unknown as ExecutableReplaceTool).execute({
      absolute_path: outsideFilePath,
      endLine: 1,
      replacementContent: 'patched',
      startLine: 1,
      targetContent: 'written',
    })

    assert.equal(replaceResult.status, 'success')
    assert.equal(await fs.readFile(outsideFilePath, 'utf8'), 'patched\n')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
    await fs.rm(outsideDirectoryPath, { force: true, recursive: true })
  }
})

test('createAgentTools write rejects identical file content', async () => {
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
      absolute_path: targetFilePath,
      content: 'export const value = 1\n',
    })

    assert.equal(result.status, 'error')
    assert.match(result.summary ?? '', /Write did not change src[/\\]same-write\.ts/u)
    assert.equal(await fs.readFile(targetFilePath, 'utf8'), 'export const value = 1\n')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools write normalizes CRLF content to LF', async () => {
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
      absolute_path: targetFilePath,
      content: 'export const first = 1\r\nexport const second = 2\r\n',
    })

    assert.equal(result.status, 'success')
    assert.equal(await fs.readFile(targetFilePath, 'utf8'), 'export const first = 1\nexport const second = 2\n')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools write rejects line-ending-only rewrites', async () => {
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
      absolute_path: targetFilePath,
      content: 'export const value = 1\n',
    })

    assert.equal(result.status, 'error')
    assert.match(result.summary ?? '', /Write did not change src[/\\]line-ending-only\.ts/u)
    assert.equal(await fs.readFile(targetFilePath, 'utf8'), 'export const value = 1\r\n')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createApplyPatchToolResult diffs against the original file snapshot for repeated file edits', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-workspace-tools-'))

  try {
    await fs.writeFile(path.join(workspaceRootPath, 'sample.txt'), 'one\ntwo\nthree\n', 'utf8')

    const result = await createApplyPatchToolResult(
      {
        checkpointId: null,
        terminalExecutionMode: 'sandbox',
        workspaceRootPath,
      },
      `<patch>
<update path="sample.txt">
@@
-one
+ONE
</update>
<update path="sample.txt">
@@
-two
+TWO
</update>
</patch>`,
    )

    assert.equal(result.resultPresentation?.kind, 'change_diff')
    assert.equal(result.resultPresentation.changes.length, 1)

    const [change] = result.resultPresentation.changes
    assert.equal(change.fileName, 'sample.txt')
    assert.equal(change.oldContent, 'one\ntwo\nthree\n')
    assert.equal(change.newContent, 'ONE\nTWO\nthree\n')
    assert.equal(change.kind, 'update')
    assert.match(result.body ?? '', /Patch applied successfully/u)
    assert.match(result.body ?? '', /M sample\.txt \(\+2 -2\)/u)
    assert.deepEqual(result.semantics?.changed_paths, ['sample.txt'])
    assert.deepEqual(result.semantics?.file_changes, [
      {
        added_line_count: 2,
        kind: 'update',
        path: 'sample.txt',
        removed_line_count: 2,
      },
    ])
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
