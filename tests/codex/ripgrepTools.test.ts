import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { __testOnly } from '../../electron/chat/shared/tools'

class FakeChildProcess extends EventEmitter {
  killed = false
  stderr = new PassThrough()
  stdout = new PassThrough()

  kill() {
    this.killed = true
    return true
  }
}

test('resolveCanonicalRipgrepPath uses the repo resources directory in development', () => {
  const canonicalPath = __testOnly.resolveCanonicalRipgrepPath({
    currentWorkingDirectory: path.join('C:', 'repo'),
    isPackagedApp: false,
  })

  assert.equal(canonicalPath, path.join('C:', 'repo', 'resources', 'ripgrep', process.platform === 'win32' ? 'rg.exe' : 'rg'))
})

test('buildRipgrepCommandCandidates returns the available development candidates before the PATH fallback', async () => {
  const canonicalPath = path.join('C:', 'repo', 'resources', 'ripgrep', process.platform === 'win32' ? 'rg.exe' : 'rg')
  const packagePath = path.join('C:', 'repo', 'node_modules', '@vscode', 'ripgrep', 'bin', process.platform === 'win32' ? 'rg.exe' : 'rg')
  const candidates = await __testOnly.buildRipgrepCommandCandidates({
    currentWorkingDirectory: path.join('C:', 'repo'),
    isPackagedApp: false,
    pathExistsImpl: async (candidatePath) => [canonicalPath, packagePath].includes(candidatePath),
    requireResolveImpl: (specifier: string) => {
      assert.equal(specifier, '@vscode/ripgrep/package.json')
      return path.join('C:', 'repo', 'node_modules', '@vscode', 'ripgrep', 'package.json')
    },
    resourcesPath: null,
  })

  assert.deepEqual(candidates, [canonicalPath, packagePath, process.platform === 'win32' ? 'rg.exe' : 'rg'])
})

test('buildRipgrepCommandCandidates resolves packaged ripgrep from an app.asar resources root', async () => {
  const packagedResourcesRoot = path.join('C:', 'repo', 'resources')
  const packagedBinaryPath = path.join(packagedResourcesRoot, 'ripgrep', process.platform === 'win32' ? 'rg.exe' : 'rg')
  const candidates = await __testOnly.buildRipgrepCommandCandidates({
    executablePath: path.join('C:', 'repo', 'TideCode.exe'),
    isPackagedApp: true,
    pathExistsImpl: async (candidatePath) => candidatePath === packagedBinaryPath,
    resourcesPath: path.join(packagedResourcesRoot, 'app.asar'),
  })

  assert.deepEqual(candidates, [packagedBinaryPath, process.platform === 'win32' ? 'rg.exe' : 'rg'])
})

test('buildRipgrepCommandCandidates infers packaged mode from process resources path', async () => {
  const packagedResourcesRoot = path.join('C:', 'repo', 'resources')
  const packagedBinaryPath = path.join(packagedResourcesRoot, 'ripgrep', process.platform === 'win32' ? 'rg.exe' : 'rg')
  const candidates = await __testOnly.buildRipgrepCommandCandidates({
    pathExistsImpl: async (candidatePath) => candidatePath === packagedBinaryPath,
    resourcesPath: path.join(packagedResourcesRoot, 'app.asar'),
  })

  assert.deepEqual(candidates, [packagedBinaryPath, process.platform === 'win32' ? 'rg.exe' : 'rg'])
})

test('runRipgrepWithCandidates retries another executable after ENOENT', async () => {
  const attemptedCommands: string[] = []
  const fakeSpawn = ((command: string) => {
    attemptedCommands.push(command)
    const child = new FakeChildProcess()

    queueMicrotask(() => {
      if (command === 'missing-rg.exe') {
        const error = new Error(`spawn ${command} ENOENT`) as NodeJS.ErrnoException
        error.code = 'ENOENT'
        child.emit('error', error)
        return
      }

      child.stdout.write('match\n')
      child.stdout.end()
      child.stderr.end()
      child.emit('close', 0)
    })

    return child as unknown as ReturnType<typeof spawn>
  }) as typeof spawn

  const result = await __testOnly.runRipgrepWithCandidates(
    ['--version'],
    path.join('C:', 'repo'),
    ['missing-rg.exe', 'working-rg.exe'],
    fakeSpawn,
  )

  assert.deepEqual(attemptedCommands, ['missing-rg.exe', 'working-rg.exe'])
  assert.equal(result.exitCode, 0)
  assert.equal(result.stdout, 'match\n')
  assert.equal(result.stderr, '')
})

test('runRipgrepWithCandidates kills the child when the caller aborts', async () => {
  const child = new FakeChildProcess()
  const fakeSpawn = (() => child as unknown as ReturnType<typeof spawn>) as typeof spawn
  const controller = new AbortController()
  const searchPromise = __testOnly.runRipgrepWithCandidates(
    ['needle'],
    path.join('C:', 'repo'),
    ['working-rg.exe'],
    fakeSpawn,
    { abortSignal: controller.signal, timeoutMs: 1_000 },
  )

  controller.abort()

  await assert.rejects(searchPromise, (error: unknown) => {
    assert.equal((error as Error).name, 'AbortError')
    return true
  })
  assert.equal(child.killed, true)
})

test('runRipgrepWithCandidates stops an oversized output stream', async () => {
  const child = new FakeChildProcess()
  const fakeSpawn = (() => {
    queueMicrotask(() => child.stdout.write('0123456789'))
    return child as unknown as ReturnType<typeof spawn>
  }) as typeof spawn

  await assert.rejects(
    __testOnly.runRipgrepWithCandidates(
      ['needle'],
      path.join('C:', 'repo'),
      ['working-rg.exe'],
      fakeSpawn,
      { maxOutputChars: 5, timeoutMs: 1_000 },
    ),
    /safety limit/u,
  )
  assert.equal(child.killed, true)
})

test('runRipgrepWithCandidates can return complete buffered lines when stdout reaches the safety limit', async () => {
  const child = new FakeChildProcess()
  const fakeSpawn = (() => {
    queueMicrotask(() => child.stdout.write(['first', 'second', 'third', ''].join(String.fromCharCode(10))))
    return child as unknown as ReturnType<typeof spawn>
  }) as typeof spawn

  const result = await __testOnly.runRipgrepWithCandidates(
    ['needle'],
    path.join('C:', 'repo'),
    ['working-rg.exe'],
    fakeSpawn,
    { maxOutputChars: 14, timeoutMs: 1_000, truncateStdoutOnLimit: true },
  )

  assert.equal(result.exitCode, 0)
  assert.equal(result.stdout, ['first', 'second', ''].join(String.fromCharCode(10)))
  assert.equal(result.stdoutTruncated, true)
  assert.equal(child.killed, true)
})

test('runRipgrepWithCandidates stops a child that exceeds the search timeout', async () => {
  const child = new FakeChildProcess()
  const fakeSpawn = (() => child as unknown as ReturnType<typeof spawn>) as typeof spawn

  await assert.rejects(
    __testOnly.runRipgrepWithCandidates(
      ['needle'],
      path.join('C:', 'repo'),
      ['working-rg.exe'],
      fakeSpawn,
      { timeoutMs: 10 },
    ),
    /exceeded the 10ms timeout/u,
  )
  assert.equal(child.killed, true)
})

test('runRipgrepFallback rejects immediately when already aborted', async () => {
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    __testOnly.runRipgrepFallback(['--files'], path.join('C:', 'repo'), { abortSignal: controller.signal }),
    (error: unknown) => {
      assert.equal((error as Error).name, 'AbortError')
      return true
    },
  )
})

test('runRipgrepFallback lists files recursively when ripgrep is unavailable', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-ripgrep-list-'))
  await fs.mkdir(path.join(workspaceRootPath, 'src', 'nested'), { recursive: true })
  await fs.mkdir(path.join(workspaceRootPath, 'node_modules', 'pkg'), { recursive: true })
  await fs.writeFile(path.join(workspaceRootPath, 'src', 'nested', 'file.ts'), 'export const value = 1;\n')
  await fs.writeFile(path.join(workspaceRootPath, 'node_modules', 'pkg', 'index.ts'), 'export const ignored = 1;\n')
  await fs.writeFile(path.join(workspaceRootPath, 'README.md'), '# Readme\n')

  const result = await __testOnly.runRipgrepFallback(
    ['--files', '--hidden', '--glob', '!**/node_modules', '--glob', '!**/node_modules/**'],
    workspaceRootPath,
  )

  assert.equal(result.exitCode, 0)
  assert.equal(result.stderr, '')
  assert.deepEqual(result.stdout.split(/\r?\n/u).sort(), ['README.md', path.join('src', 'nested', 'file.ts')].sort())
})

test('runRipgrepFallback includes AGENTS.md in file listings and content matches', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-ripgrep-agents-'))

  try {
    await fs.mkdir(path.join(workspaceRootPath, 'nested'), { recursive: true })
    await fs.writeFile(path.join(workspaceRootPath, '.gitignore'), 'AGENTS.md\n**/agents.md\n', 'utf8')
    await fs.writeFile(path.join(workspaceRootPath, 'AGENTS.md'), 'AgentInstructionNeedle\n')
    await fs.writeFile(path.join(workspaceRootPath, 'nested', 'agents.md'), 'nestedAgentInstructionNeedle\n')
    await fs.writeFile(path.join(workspaceRootPath, 'visible.ts'), 'export const visible = true;\n')

    const listResult = await __testOnly.runRipgrepFallback(
      ['--files', '--hidden', '--glob', '**/*'],
      workspaceRootPath,
    )
    const grepResult = await __testOnly.runRipgrepFallback(
      ['-nH', '--hidden', '--no-messages', '--field-match-separator=|', '--regexp', 'AgentInstructionNeedle', workspaceRootPath],
      workspaceRootPath,
    )

    assert.equal(listResult.exitCode, 0)
    assert.deepEqual(listResult.stdout.split(/\r?\n/u).sort(), ['.gitignore', 'AGENTS.md', path.join('nested', 'agents.md'), 'visible.ts'].sort())
    assert.equal(grepResult.exitCode, 0)
    assert.match(grepResult.stdout, /AGENTS\.md/u)
    assert.match(grepResult.stdout, /nested[\\/]agents\.md/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('runRipgrepFallback filters recursive file listings by glob', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-ripgrep-glob-'))
  await fs.mkdir(path.join(workspaceRootPath, 'src', 'nested'), { recursive: true })
  await fs.writeFile(path.join(workspaceRootPath, 'src', 'nested', 'file.ts'), 'export const value = 1;\n')
  await fs.writeFile(path.join(workspaceRootPath, 'src', 'nested', 'file.test.ts'), 'test()\n')
  await fs.writeFile(path.join(workspaceRootPath, 'src', 'nested', 'file.js'), 'console.log("x")\n')

  const result = await __testOnly.runRipgrepFallback(['--files', '--hidden', '--glob', '**/*.test.ts'], workspaceRootPath)

  assert.equal(result.exitCode, 0)
  assert.equal(result.stderr, '')
  assert.deepEqual(result.stdout.split(/\r?\n/u), [path.join('src', 'nested', 'file.test.ts')])
})

test('runRipgrepFallback applies basename include globs to nested grep results', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-ripgrep-basename-glob-'))
  await fs.mkdir(path.join(workspaceRootPath, 'src', 'nested'), { recursive: true })
  await fs.writeFile(path.join(workspaceRootPath, 'src', 'nested', 'file.ts'), 'const needle = true;\n')
  await fs.writeFile(path.join(workspaceRootPath, 'src', 'nested', 'file.js'), 'const needle = true;\n')

  try {
    const result = await __testOnly.runRipgrepFallback(
      ['-nH', '--hidden', '--glob', '*.ts', '--regexp', 'needle', workspaceRootPath],
      workspaceRootPath,
    )

    assert.equal(result.exitCode, 0)
    assert.equal(result.stderr, '')
    assert.deepEqual(result.stdout.split(/\r?\n/u), [
      `${path.join(workspaceRootPath, 'src', 'nested', 'file.ts')}|1|const needle = true;`,
    ])
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('runRipgrepFallback searches file contents and emits json match lines', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-ripgrep-search-'))
  await fs.mkdir(path.join(workspaceRootPath, 'src'), { recursive: true })
  await fs.writeFile(path.join(workspaceRootPath, 'src', 'example.ts'), 'const foo = 1;\nconst bar = foo + 1;\n')
  await fs.writeFile(path.join(workspaceRootPath, 'src', 'other.ts'), 'const baz = 2;\n')

  const result = await __testOnly.runRipgrepFallback(
    ['--json', '--hidden', '--line-number', '--no-messages', 'foo', '.'],
    workspaceRootPath,
  )

  assert.equal(result.exitCode, 0)
  assert.equal(result.stderr, '')
  const lines = result.stdout.split(/\r?\n/u).filter((line) => line.length > 0)
  assert.equal(lines.length, 2)

  const parsedLines = lines.map((line) => JSON.parse(line) as { data: { line_number: number; path: { text: string } } })
  assert.deepEqual(
    parsedLines.map((line) => ({
      line_number: line.data.line_number,
      path: line.data.path.text,
    })),
    [
      {
        line_number: 1,
        path: path.join('src', 'example.ts'),
      },
      {
        line_number: 2,
        path: path.join('src', 'example.ts'),
      },
    ],
  )
})

test('runRipgrepFallback searches file contents with ripgrep-style grep output', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-ripgrep-grep-'))
  await fs.mkdir(path.join(workspaceRootPath, 'src'), { recursive: true })
  await fs.mkdir(path.join(workspaceRootPath, '.git'), { recursive: true })
  await fs.writeFile(path.join(workspaceRootPath, 'src', 'example.ts'), 'const foo = 1;\nconst bar = foo + 1;\n')
  await fs.writeFile(path.join(workspaceRootPath, '.git', 'config'), 'const foo = 3;\n')

  const result = await __testOnly.runRipgrepFallback(
    ['-nH', '--hidden', '--no-messages', '--field-match-separator=|', '--regexp', 'foo', workspaceRootPath],
    workspaceRootPath,
  )

  assert.equal(result.exitCode, 0)
  assert.equal(result.stderr, '')
  const lines = result.stdout.split(/\r?\n/u).filter((line) => line.length > 0)
  assert.deepEqual(lines, [
    `${path.join(workspaceRootPath, 'src', 'example.ts')}|1|const foo = 1;`,
    `${path.join(workspaceRootPath, 'src', 'example.ts')}|2|const bar = foo + 1;`,
  ])
})

test('runRipgrepFallback supports ripgrep-style grep output when search path is a file', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-ripgrep-grep-file-'))
  await fs.mkdir(path.join(workspaceRootPath, 'src'), { recursive: true })
  const filePath = path.join(workspaceRootPath, 'src', 'example.ts')
  await fs.writeFile(filePath, 'const foo = 1;\nconst bar = foo + 1;\n')

  const result = await __testOnly.runRipgrepFallback(
    ['-nH', '--hidden', '--no-messages', '--field-match-separator=|', '--regexp', 'foo', filePath],
    workspaceRootPath,
  )

  assert.equal(result.exitCode, 0)
  assert.equal(result.stderr, '')
  const lines = result.stdout.split(/\r?\n/u).filter((line) => line.length > 0)
  assert.deepEqual(lines, [
    `${filePath}|1|const foo = 1;`,
    `${filePath}|2|const bar = foo + 1;`,
  ])
})
