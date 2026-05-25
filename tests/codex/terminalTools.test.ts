import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { WebContents } from 'electron'
import { createAgentTools } from '../../electron/chat/shared/tools'
import { createTerminalToolSet } from '../../electron/chat/shared/tools/terminalTools'

const webContentsStub = {
  id: 42,
  isDestroyed: () => false,
  once: () => undefined,
} as unknown as WebContents

type RunTerminalResult = {
  body?: string
  semantics?: Record<string, unknown>
  status?: string
  summary?: string
  truncated?: boolean
}

type RunTerminalTool = {
  execute: (
    input: {
      cols: number
      command?: string
      cwd?: string
      rows: number
      session_key?: string
    },
    options?: { abortSignal?: AbortSignal },
  ) => Promise<RunTerminalResult>
}

function getRunTerminalTool(tools: ReturnType<typeof createTerminalToolSet>) {
  return tools.run_terminal as unknown as RunTerminalTool
}

function readCompletionMarker(writtenCommand: string) {
  const markerMatch = writtenCommand.match(/__ECHOSPHERE_COMMAND_DONE_[A-Za-z0-9_]+__/u)
  assert.ok(markerMatch, 'expected run_terminal to append a completion marker')
  return markerMatch[0]
}

function pathExists(targetPath: string) {
  return existsSync(targetPath)
}

test('run_terminal queues a command, waits for completion, and returns cleaned output', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-terminal-tools-workspace-'))
  const nestedPath = path.join(workspaceRootPath, 'nested')
  await fs.mkdir(nestedPath, { recursive: true })
  const createCalls: Array<{
    cols: number
    cwd?: string
    rows: number
    sessionKey?: string | null
    workspaceRootPath?: string | null
  }> = []
  const writeCalls: Array<{ data: string; sessionId: number }> = []
  const getSessionOutputCalls: Array<{ pollingMs?: number; sessionId: number; workspaceRootPath?: string | null }> = []

  try {
    const tools = createTerminalToolSet(
      {
        conversationId: 'conversation-a',
        webContents: webContentsStub,
        workspaceRootPath,
      },
      {
        createSession: async (_owner, input) => {
          createCalls.push(input)
          return {
            bufferedOutput: 'ready\n',
            cwd: nestedPath,
            isReused: false,
            sessionId: 7,
            shell: 'pwsh',
          }
        },
        getSessionOutput: async (_owner, input) => {
          getSessionOutputCalls.push(input)
          const marker = readCompletionMarker(writeCalls[0]?.data ?? '')
          return {
            cwd: nestedPath,
            exitCode: null,
            hasExited: false,
            outputBuffer: `\u001B[32mline 1\u001B[0m\r\nline 2\r\n${marker}:0\r\n`,
            shellLabel: 'pwsh',
            signal: null,
            sessionId: input.sessionId,
          }
        },
        writeToSession: async (_owner, input) => {
          writeCalls.push(input)
        },
      },
    )

    const result = await getRunTerminalTool(tools).execute({
      cols: 120,
      command: 'npm test',
      cwd: 'nested',
      rows: 30,
      session_key: 'build',
    })

    assert.deepEqual(createCalls, [
      {
        cols: 120,
        cwd: nestedPath,
        rows: 30,
        sessionKey: 'build',
        workspaceRootPath,
      },
    ])
    assert.equal(writeCalls.length, 1)
    assert.equal(writeCalls[0].sessionId, 7)
    assert.match(writeCalls[0].data, /npm test/u)
    assert.doesNotMatch(writeCalls[0].data, /\r\n/u)
    assert.match(writeCalls[0].data, /__ECHOSPHERE_COMMAND_DONE_/u)
    assert.deepEqual(getSessionOutputCalls, [
      {
        pollingMs: 500,
        sessionId: 7,
        workspaceRootPath,
      },
    ])
    assert.doesNotMatch(result.body ?? '', /Started session 1/u)
    assert.doesNotMatch(result.body ?? '', /Command queued: npm test/u)
    assert.match(result.body ?? '', /line 1/u)
    assert.match(result.body ?? '', /line 2/u)
    assert.ok(!(result.body ?? '').includes('\u001B'))
    assert.doesNotMatch(result.body ?? '', /__ECHOSPHERE_COMMAND_DONE_/u)
    assert.equal(result.semantics?.command_completed, true)
    assert.equal(result.semantics?.command_exit_code, 0)
    assert.equal(result.semantics?.timed_out, false)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('run_terminal truncates large git diff output before returning it to the model', async () => {
  const largeDiffOutput = `diff --git a/file.ts b/file.ts\n${'+changed line\n'.repeat(2500)}`
  const tools = createTerminalToolSet(
    {
      conversationId: 'conversation-large-diff',
      webContents: webContentsStub,
      workspaceRootPath: '/workspace',
    },
    {
      createSession: async () => ({
        bufferedOutput: '',
        cwd: '/workspace',
        isReused: false,
        sessionId: 91,
        shell: 'pwsh',
      }),
      getSessionOutput: async (_owner, input) => {
        const marker = readCompletionMarker(writeCalls[0]?.data ?? '')
        return {
          cwd: '/workspace',
          exitCode: null,
          hasExited: false,
          outputBuffer: `${largeDiffOutput}\n${marker}:0\n`,
          shellLabel: 'pwsh',
          signal: null,
          sessionId: input.sessionId,
        }
      },
      writeToSession: async (_owner, input) => {
        writeCalls.push(input)
      },
    },
  )
  const writeCalls: Array<{ data: string; sessionId: number }> = []

  const result = await getRunTerminalTool(tools).execute({
    cols: 120,
    command: 'git diff',
    cwd: '.',
    rows: 30,
  })

  assert.equal(result.status, 'success')
  assert.match(writeCalls[0]?.data ?? '', /git --no-pager diff/u)
  assert.equal(result.semantics?.truncated_output, true)
  assert.equal(result.truncated, true)
  assert.match(result.body ?? '', /Output truncated at 20000 characters/u)
  assert.match(result.body ?? '', /prefer `git diff --stat`/u)
  assert.ok((result.body ?? '').length < largeDiffOutput.length)
})

test('run_terminal starts at session 1 in a different conversation thread without polling when no command is provided', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-terminal-tools-thread-'))
  let getSessionOutputCalled = false

  try {
    const tools = createTerminalToolSet(
      {
        conversationId: 'conversation-b',
        webContents: webContentsStub,
        workspaceRootPath,
      },
      {
        createSession: async () => ({
          bufferedOutput: '',
          cwd: workspaceRootPath,
          isReused: false,
          sessionId: 8,
          shell: 'pwsh',
        }),
        getSessionOutput: async () => {
          getSessionOutputCalled = true
          throw new Error('unexpected getSessionOutput call')
        },
        writeToSession: async () => undefined,
      },
    )

    const result = await getRunTerminalTool(tools).execute({
      cols: 120,
      cwd: '.',
      rows: 30,
      session_key: 'build',
    })

    assert.doesNotMatch(result.body ?? '', /Started session 1/u)
    assert.match(result.body ?? '', /No terminal output yet\./u)
    assert.equal(result.semantics?.command, null)
    assert.equal(getSessionOutputCalled, false)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('run_terminal rejects commands outside the allowlist without launching a terminal', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-terminal-apply-patch-'))
  let createSessionCalled = false

  try {
    const tools = createTerminalToolSet(
      {
        conversationId: 'conversation-apply-patch',
        webContents: webContentsStub,
        workspaceRootPath,
      },
      {
        createSession: async () => {
          createSessionCalled = true
          throw new Error('unexpected terminal launch')
        },
        getSessionOutput: async () => {
          throw new Error('unexpected terminal output poll')
        },
        writeToSession: async () => undefined,
      },
    )

    const result = await getRunTerminalTool(tools).execute({
      cols: 120,
      command: `apply_patch <<'PATCH'
*** Begin Patch
*** Add File: src/from-terminal.txt
+hello
*** End Patch
PATCH`,
      cwd: '.',
      rows: 30,
    })

    assert.equal(createSessionCalled, false)
    assert.equal(result.status, 'error')
    assert.match(result.summary ?? '', /only allows commands listed/u)
    assert.equal(pathExists(path.join(workspaceRootPath, 'src', 'from-terminal.txt')), false)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('run_terminal rejects cd-prefixed commands outside the allowlist without launching a terminal', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-terminal-apply-patch-cd-'))
  await fs.mkdir(path.join(workspaceRootPath, 'packages', 'app'), { recursive: true })
  let createSessionCalled = false

  try {
    const tools = createTerminalToolSet(
      {
        conversationId: 'conversation-apply-patch-cd',
        webContents: webContentsStub,
        workspaceRootPath,
      },
      {
        createSession: async () => {
          createSessionCalled = true
          throw new Error('unexpected terminal launch')
        },
        getSessionOutput: async () => {
          throw new Error('unexpected terminal output poll')
        },
        writeToSession: async () => undefined,
      },
    )

    const result = await getRunTerminalTool(tools).execute({
      cols: 120,
      command: `cd packages/app && applypatch <<EOF
*** Begin Patch
*** Add File: local.txt
+scoped
*** End Patch
EOF`,
      cwd: '.',
      rows: 30,
    })

    assert.equal(createSessionCalled, false)
    assert.equal(result.status, 'error')
    assert.match(result.summary ?? '', /only allows commands listed/u)
    assert.equal(pathExists(path.join(workspaceRootPath, 'packages', 'app', 'local.txt')), false)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('run_terminal allows unrestricted commands in full access mode', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-terminal-full-access-'))
  const createCalls: Array<{
    cols: number
    cwd?: string
    rows: number
    sessionKey?: string | null
    workspaceRootPath?: string | null
  }> = []
  const writeCalls: Array<{ data: string; sessionId: number }> = []

  try {
    const tools = createTerminalToolSet(
      {
        conversationId: 'conversation-full-access',
        terminalExecutionMode: 'full',
        webContents: webContentsStub,
        workspaceRootPath,
      },
      {
        createSession: async (_owner, input) => {
          createCalls.push(input)
          return {
            bufferedOutput: '',
            cwd: workspaceRootPath,
            isReused: false,
            sessionId: 19,
            shell: 'pwsh',
          }
        },
        getSessionOutput: async (_owner, input) => {
          const marker = readCompletionMarker(writeCalls[0]?.data ?? '')
          return {
            cwd: workspaceRootPath,
            exitCode: null,
            hasExited: false,
            outputBuffer: `hello from full access\n${marker}:0\n`,
            shellLabel: 'pwsh',
            signal: null,
            sessionId: input.sessionId,
          }
        },
        writeToSession: async (_owner, input) => {
          writeCalls.push(input)
        },
      },
    )

    const result = await getRunTerminalTool(tools).execute({
      cols: 120,
      command: 'echo hello && whoami',
      cwd: '.',
      rows: 30,
      session_key: 'full-access',
    })

    assert.equal(result.status, 'success')
    assert.equal(createCalls.length, 1)
    assert.equal(writeCalls.length, 1)
    assert.match(writeCalls[0].data, /echo hello && whoami/u)
    assert.match(result.body ?? '', /hello from full access/u)
    assert.equal(result.semantics?.command_completed, true)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('run_terminal increments local session ids sequentially', async () => {
  let nextGlobalSessionId = 30
  const tools = createTerminalToolSet(
    {
      conversationId: 'conversation-sequential',
      webContents: webContentsStub,
      workspaceRootPath: '/workspace',
    },
    {
      createSession: async () => ({
        bufferedOutput: '',
        cwd: '/workspace',
        isReused: false,
        sessionId: nextGlobalSessionId++,
        shell: 'pwsh',
      }),
      getSessionOutput: async () => {
        throw new Error('unexpected getSessionOutput call')
      },
      writeToSession: async () => undefined,
    },
  )

  const firstRunResult = await getRunTerminalTool(tools).execute({
    cols: 120,
    cwd: '.',
    rows: 30,
    session_key: 'first',
  })

  const secondRunResult = await getRunTerminalTool(tools).execute({
    cols: 120,
    cwd: '.',
    rows: 30,
    session_key: 'second',
  })

  assert.doesNotMatch(firstRunResult.body ?? '', /Started session 1/u)
  assert.doesNotMatch(secondRunResult.body ?? '', /Started session 2/u)
  assert.match(firstRunResult.body ?? '', /No terminal output yet\./u)
  assert.match(secondRunResult.body ?? '', /No terminal output yet\./u)
})

test('run_terminal aborts promptly while waiting for command output', async () => {
  let releaseOutput: (() => void) | null = null
  const outputPromiseGate = new Promise<void>((resolve) => {
    releaseOutput = resolve
  })
  const tools = createTerminalToolSet(
    {
      conversationId: 'conversation-abort',
      webContents: webContentsStub,
      workspaceRootPath: '/workspace',
    },
    {
      createSession: async () => ({
        bufferedOutput: '',
        cwd: '/workspace',
        isReused: false,
        sessionId: 41,
        shell: 'pwsh',
      }),
      getSessionOutput: async (_owner, input) => {
        await outputPromiseGate
        return {
          cwd: '/workspace',
          exitCode: null,
          hasExited: false,
          outputBuffer: 'late output\n',
          shellLabel: 'pwsh',
          signal: null,
          sessionId: input.sessionId,
        }
      },
      writeToSession: async () => undefined,
    },
  )

  const abortController = new AbortController()
  const outputPromise = getRunTerminalTool(tools).execute(
    {
      cols: 120,
      command: 'npm test',
      cwd: '.',
      rows: 30,
      session_key: 'abortable-poll',
    },
    {
      abortSignal: abortController.signal,
    },
  )

  abortController.abort(new Error('Canceled by test'))

  await assert.rejects(outputPromise, /Canceled by test/u)
  releaseOutput?.()
})

test('createAgentTools exposes only run_terminal in agent mode when a webContents owner is available', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-terminal-tools-'))

  try {
    const agentTools = await createAgentTools(
      {
        webContents: webContentsStub,
        workspaceRootPath,
      },
      {
        chatMode: 'agent',
      },
    )
    const planTools = await createAgentTools(
      {
        webContents: webContentsStub,
        workspaceRootPath,
      },
      {
        chatMode: 'plan',
      },
    )

    assert.ok('run_terminal' in agentTools)
    assert.ok(!('get_terminal_output' in agentTools))
    assert.ok(!('run_terminal' in planTools))
    assert.ok(!('get_terminal_output' in planTools))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
