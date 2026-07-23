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

type ExecuteTerminalResult = {
  body?: string
  semantics?: Record<string, unknown>
  status?: string
  summary?: string
  truncated?: boolean
}

type ExecuteTerminalTool = {
  execute: (
    input: {
      mode: 'execute' | 'read' | 'list' | 'end'
      cols?: number
      command?: string
      cwd?: string
      rows?: number
      session_id?: number
      session_key?: string
      wait_ms?: number
    },
    options?: { abortSignal?: AbortSignal },
  ) => Promise<ExecuteTerminalResult>
}

function getExecuteTerminalTool(tools: ReturnType<typeof createTerminalToolSet>) {
  return tools.execute_terminal as unknown as ExecuteTerminalTool
}

function readCompletionMarker(writtenCommand: string) {
  const markerMatch = writtenCommand.match(/__EDONE_[A-Za-z0-9_]+__/u)
  assert.ok(markerMatch, 'expected execute_terminal to append a completion marker')
  return markerMatch[0]
}

function pathExists(targetPath: string) {
  return existsSync(targetPath)
}

test('execute_terminal mode=execute queues command in background and mode=read fetches cleaned output', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-terminal-tools-workspace-'))
  const nestedPath = path.join(workspaceRootPath, 'nested')
  await fs.mkdir(nestedPath, { recursive: true })
  const createCalls: Array<{
    cols: number
    cwd?: string
    enableIdleTimeout?: boolean
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
        listSessions: () => [],
        terminateSession: () => undefined,
        writeToSession: async (_owner, input) => {
          writeCalls.push(input)
        },
      },
    )

    const execResult = await getExecuteTerminalTool(tools).execute({
      mode: 'execute',
      cols: 120,
      command: 'npm test',
      cwd: 'nested',
      rows: 30,
      session_key: 'build',
    })

    assert.equal(execResult.status, 'success')
    assert.match(execResult.body ?? '', /Command started in background\. session_id: 7/u)
    assert.deepEqual(createCalls, [
      {
        cols: 120,
        cwd: nestedPath,
        enableIdleTimeout: true,
        label: null,
        rows: 30,
        sessionKey: 'build',
        workspaceRootPath,
      },
    ])
    assert.equal(writeCalls.length, 1)
    assert.equal(writeCalls[0].sessionId, 7)
    assert.match(writeCalls[0].data, /npm test/u)

    const readResult = await getExecuteTerminalTool(tools).execute({
      mode: 'read',
      session_id: 7,
      wait_ms: 500,
    })

    assert.equal(readResult.status, 'success')
    assert.match(readResult.body ?? '', /line 1/u)
    assert.match(readResult.body ?? '', /line 2/u)
    assert.ok(!(readResult.body ?? '').includes('\u001B'))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('execute_terminal mode=read truncates large git diff output', async () => {
  const largeDiffOutput = `diff --git a/file.ts b/file.ts\n${'+changed line\n'.repeat(2500)}`
  const writeCalls: Array<{ data: string; sessionId: number }> = []

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
        return {
          cwd: '/workspace',
          exitCode: null,
          hasExited: false,
          outputBuffer: `${largeDiffOutput}\n`,
          shellLabel: 'pwsh',
          signal: null,
          sessionId: input.sessionId,
        }
      },
      listSessions: () => [],
      terminateSession: () => undefined,
      writeToSession: async (_owner, input) => {
        writeCalls.push(input)
      },
    },
  )

  await getExecuteTerminalTool(tools).execute({
    mode: 'execute',
    cols: 120,
    command: 'git diff',
    rows: 30,
  })

  const readResult = await getExecuteTerminalTool(tools).execute({
    mode: 'read',
    session_id: 91,
  })

  assert.equal(readResult.status, 'success')
  assert.equal(readResult.semantics?.truncated_output, true)
  assert.equal(readResult.truncated, true)
  assert.match(readResult.body ?? '', /Output truncated at 20000 characters/u)
})

test('execute_terminal rejects commands outside the allowlist in sandbox mode', async () => {
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
        listSessions: () => [],
        terminateSession: () => undefined,
        writeToSession: async () => undefined,
      },
    )

    const result = await getExecuteTerminalTool(tools).execute({
      mode: 'execute',
      cols: 120,
      command: `cd ../outside`,
      rows: 30,
    })

    assert.equal(createSessionCalled, false)
    assert.equal(result.status, 'error')
    assert.match(result.body ?? '', /Directory traversal \(\.\.\) is not allowed/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('execute_terminal allows unrestricted commands in full access mode', async () => {
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
          return {
            cwd: workspaceRootPath,
            exitCode: null,
            hasExited: false,
            outputBuffer: `hello from full access\n`,
            shellLabel: 'pwsh',
            signal: null,
            sessionId: input.sessionId,
          }
        },
        listSessions: () => [],
        terminateSession: () => undefined,
        writeToSession: async (_owner, input) => {
          writeCalls.push(input)
        },
      },
    )

    const result = await getExecuteTerminalTool(tools).execute({
      mode: 'execute',
      cols: 120,
      command: 'echo hello && whoami',
      rows: 30,
      session_key: 'full-access',
    })

    assert.equal(result.status, 'success')
    assert.equal(createCalls.length, 1)
    assert.equal(writeCalls.length, 1)
    assert.match(writeCalls[0].data, /echo hello && whoami/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools exposes execute_terminal in agent mode when webContents is available', async () => {
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

    assert.ok('execute_terminal' in agentTools)
    assert.ok(!('execute_terminal' in planTools))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('execute_terminal allows a cwd outside the workspace root in Full Access mode', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-terminal-outside-ws-'))
  const outsideDirectoryPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-terminal-outside-dir-'))
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
        conversationId: 'conversation-full-access-outside',
        terminalExecutionMode: 'full',
        webContents: webContentsStub,
        workspaceRootPath,
      },
      {
        createSession: async (_owner, input) => {
          createCalls.push(input)
          return {
            bufferedOutput: '',
            cwd: outsideDirectoryPath,
            isReused: false,
            sessionId: 20,
            shell: 'pwsh',
          }
        },
        getSessionOutput: async (_owner, input) => {
          return {
            cwd: outsideDirectoryPath,
            exitCode: null,
            hasExited: false,
            outputBuffer: `hello from outside cwd\n`,
            shellLabel: 'pwsh',
            signal: null,
            sessionId: input.sessionId,
          }
        },
        listSessions: () => [],
        terminateSession: () => undefined,
        writeToSession: async (_owner, input) => {
          writeCalls.push(input)
        },
      },
    )

    const result = await getExecuteTerminalTool(tools).execute({
      mode: 'execute',
      cols: 120,
      command: 'echo hello',
      cwd: outsideDirectoryPath,
      rows: 30,
      session_key: 'outside-access',
    })

    assert.equal(result.status, 'success')
    assert.equal(createCalls.length, 1)
    assert.equal(createCalls[0].cwd, outsideDirectoryPath)
    assert.equal(writeCalls.length, 1)
    assert.match(writeCalls[0].data, /echo hello/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
    await fs.rm(outsideDirectoryPath, { force: true, recursive: true })
  }
})
