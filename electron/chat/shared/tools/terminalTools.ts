import path from 'node:path'
import type { WebContents } from 'electron'
import { jsonSchema, tool, type ToolSet } from 'ai'
import type {
  CreateTerminalSessionInput,
  CreateTerminalSessionResult,
  TerminalSessionOutputInput,
  WriteTerminalSessionInput,
} from '../../../../src/types/chat'
import type { AgentToolContext, AgentToolExecutionResult } from '../toolTypes'
import type { TerminalSessionSnapshot, TerminalSessionInfo } from '../../../terminal/service'
import {
  captureWorkspaceCheckpointTerminalPostState,
  captureWorkspaceCheckpointTerminalPreState,
} from '../../../workspace/checkpoints'
import { resolveReadableTargetPath } from './workspaceTools'

const ANSI_ESCAPE = '\u001B'
const TERMINAL_BELL = '\u0007'
const ANSI_CSI_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-?]*[ -/]*[@-~]`, 'g')
const ANSI_OSC_PATTERN = new RegExp(`${ANSI_ESCAPE}\\][^${TERMINAL_BELL}${ANSI_ESCAPE}]*(?:${TERMINAL_BELL}|${ANSI_ESCAPE}\\\\)`, 'g')
const ANSI_SINGLE_ESCAPE_PATTERN = new RegExp(`${ANSI_ESCAPE}[@-Z\\-_]`, 'g')


interface TerminalToolDependencies {
  createSession: (
    ownerWebContents: WebContents,
    input: CreateTerminalSessionInput,
  ) => Promise<CreateTerminalSessionResult>
  getSessionOutput: (
    ownerWebContents: WebContents,
    input: TerminalSessionOutputInput,
  ) => Promise<TerminalSessionSnapshot>
  listSessions: (
    ownerWebContents: WebContents,
    workspaceRootPath: string,
  ) => TerminalSessionInfo[]
  terminateSession: (
    ownerWebContents: WebContents,
    sessionId: number,
    workspaceRootPath: string,
  ) => void
  writeToSession: (
    ownerWebContents: WebContents,
    input: WriteTerminalSessionInput,
  ) => Promise<void>
}

function toAbortError(abortSignal: AbortSignal | undefined) {
  const reason = abortSignal?.reason
  if (reason instanceof Error) {
    return reason
  }

  return new Error('Terminal tool execution aborted.')
}

function throwIfAborted(abortSignal: AbortSignal | undefined) {
  if (!abortSignal?.aborted) {
    return
  }

  throw toAbortError(abortSignal)
}

function raceWithAbort<T>(promise: Promise<T>, abortSignal: AbortSignal | undefined) {
  if (!abortSignal) {
    return promise
  }

  if (abortSignal.aborted) {
    return Promise.reject(toAbortError(abortSignal))
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      abortSignal.removeEventListener('abort', handleAbort)
      reject(toAbortError(abortSignal))
    }

    abortSignal.addEventListener('abort', handleAbort, { once: true })
    promise.then(
      (value) => {
        abortSignal.removeEventListener('abort', handleAbort)
        resolve(value)
      },
      (error) => {
        abortSignal.removeEventListener('abort', handleAbort)
        reject(error)
      },
    )
  })
}

async function loadDefaultTerminalToolDependencies(): Promise<TerminalToolDependencies> {
  const terminalService = await import('../../../terminal/service')
  return {
    createSession: terminalService.createTerminalSessionForWebContents,
    getSessionOutput: terminalService.getTerminalSessionOutputForWebContents,
    listSessions: terminalService.listSessionsForWebContents,
    terminateSession: terminalService.terminateSessionForWebContents,
    writeToSession: terminalService.writeToTerminalSessionForWebContents,
  }
}

function createSuccessResult(input: Omit<AgentToolExecutionResult, 'status'>): AgentToolExecutionResult {
  return {
    ...input,
    status: 'success',
  }
}

function createErrorResult(summary: string, body?: string): AgentToolExecutionResult {
  return {
    ...(body ? { body } : {}),
    status: 'error',
    summary,
  }
}

function getExecuteTerminalDescription() {
  const osHint = process.platform === 'win32'
    ? ' Shell is PowerShell. Use PowerShell syntax.'
    : ''

  const usageHint =
    ' Use for commands, tests, builds, package tools, and runtime checks when the task requires them; prefer dedicated tools for reading and editing files.'

  return [
    `Manage terminal sessions. mode parameter controls action:`,
    `- execute: Run a command in background. Returns session_id immediately. Use for long-running commands (npm run dev, etc).`,
    `- read: Read output from a background session by session_id.`,
    `- list: List all active terminal sessions.`,
    `- end: Kill a terminal session by session_id.`,
    osHint,
    usageHint,
  ].join(' ')
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  const boundedValue = Math.floor(value)
  if (boundedValue < min) {
    return min
  }

  if (boundedValue > max) {
    return max
  }

  return boundedValue
}

function isGitDiffCommand(command: string | null) {
  if (!command) {
    return false
  }

  return /(?:^|[;&|]\s*)git(?:\s+--no-pager)?\s+diff(?:\s|$)/iu.test(command.trim())
}

function preventGitDiffPager(command: string) {
  return command.replace(/(^|[;&|]\s*)git\s+diff(\s|$)/giu, '$1git --no-pager diff$2')
}

function prepareTerminalCommand(command: string | null) {
  if (!command) {
    return null
  }

  return isGitDiffCommand(command) ? preventGitDiffPager(command) : command
}



function truncateTerminalOutput(value: string, _command: string | null) {
  return {
    body: value,
    truncated: false,
  }
}

function sanitizeTerminalOutput(value: string) {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(ANSI_OSC_PATTERN, '')
    .replace(ANSI_CSI_PATTERN, '')
    .replace(ANSI_SINGLE_ESCAPE_PATTERN, '')
    .replace(/;\s*echo\s*"__EDONE_[^"]*"/gi, '')
    .replace(/__EDONE_[a-z0-9_]+(?::\d*)?/gi, '')
    .replace(/;\s*echo\s*":?\$\([^)]*\)"/gi, '')
    .replace(/;\s*echo\s*":?\$\?"/gi, '')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0)
      return !(
        (code >= 0 && code <= 8) ||
        code === 11 ||
        (code >= 26 && code <= 31) ||
        code === 127
      )
    })
    .join('')
}



function normalizeCommand(command: string | undefined) {
  if (typeof command !== 'string') {
    return null
  }

  const trimmed = command.trim()
  return trimmed.length > 0 ? trimmed : null
}

interface ThreadAiSession {
  localSessionId: number
  globalSessionId: number
  label: string | null
  cwd: string
  command: string
  shell: string
  lastReadOffset: number
}

interface ThreadSessionStore {
  nextLocalSessionId: number
  latestLocalSessionId: number | null
  sessions: Map<number, ThreadAiSession>
}

const threadStores = new Map<string, ThreadSessionStore>()

function getOrCreateThreadStore(namespace: string): ThreadSessionStore {
  let store = threadStores.get(namespace)
  if (!store) {
    store = {
      nextLocalSessionId: 1,
      latestLocalSessionId: null,
      sessions: new Map(),
    }
    threadStores.set(namespace, store)
  }
  return store
}

async function pruneAndResetThreadStore(
  store: ThreadSessionStore,
  ownerWebContents: WebContents,
  resolvedDependencies: TerminalToolDependencies,
  workspaceRootPath: string,
) {
  if (store.sessions.size === 0) {
    store.nextLocalSessionId = 1
    store.latestLocalSessionId = null
    return
  }

  const entries = Array.from(store.sessions.entries())
  for (const [localId, session] of entries) {
    try {
      const snapshot = await resolvedDependencies.getSessionOutput(ownerWebContents, {
        pollingMs: 0,
        sessionId: session.globalSessionId,
        workspaceRootPath,
      })

      if (snapshot.hasExited || (typeof snapshot.outputBuffer === 'string' && snapshot.outputBuffer.includes('__EDONE_'))) {
        try {
          resolvedDependencies.terminateSession(ownerWebContents, session.globalSessionId, workspaceRootPath)
        } catch {
          // ignore
        }
        store.sessions.delete(localId)
      }
    } catch {
      store.sessions.delete(localId)
    }
  }

  if (store.sessions.size === 0) {
    store.nextLocalSessionId = 1
    store.latestLocalSessionId = null
  }
}

export async function cleanUpFinishedSessionsAtTurnEnd(
  webContents: WebContents,
  workspaceRootPath: string,
  conversationId?: string | null,
) {
  const terminalService = await loadDefaultTerminalToolDependencies()

  const namespacesToClean: string[] = []
  if (conversationId?.trim()) {
    namespacesToClean.push(`conversation:${conversationId.trim()}`)
  } else {
    namespacesToClean.push(...threadStores.keys())
  }

  for (const ns of namespacesToClean) {
    const store = threadStores.get(ns)
    if (!store) continue

    await pruneAndResetThreadStore(store, webContents, terminalService, workspaceRootPath)
  }
}

function resolveTerminalWorkspaceCwd(context: AgentToolContext, cwd: string | undefined) {
  const terminalExecutionMode = context.terminalExecutionMode ?? 'sandbox'
  return resolveReadableTargetPath(context.workspaceRootPath, cwd, terminalExecutionMode).absolutePath
}

function resolveTerminalThreadNamespace(context: AgentToolContext) {
  const conversationId = context.conversationId?.trim()
  if (conversationId && conversationId.length > 0) {
    return `conversation:${conversationId}`
  }

  return `workspace:${context.workspaceRootPath}`
}

function createCompletionMarker(localSessionId: number) {
  return `__EDONE_${localSessionId.toString(36)}_${Date.now().toString(36)}__`
}

function buildMarkedCommand(command: string, shellLabel: string, marker: string) {
  const normalizedShellLabel = shellLabel.toLowerCase()
  const trimmedCommand = command.trimEnd()

  if (normalizedShellLabel.includes('powershell') || normalizedShellLabel.includes('pwsh')) {
    return `${trimmedCommand}; echo "${marker}:$([int]$LASTEXITCODE)"\r`
  }

  if (normalizedShellLabel.includes('command prompt') || normalizedShellLabel === 'cmd' || normalizedShellLabel.includes('cmd.exe')) {
    return `${trimmedCommand} & echo ${marker}:%ERRORLEVEL%\r`
  }

  return `${trimmedCommand}; echo "${marker}:$?"\r`
}

export function createTerminalToolSet(
  context: AgentToolContext,
  dependencies: Partial<TerminalToolDependencies> = {},
): ToolSet {
  const ownerWebContents = context.webContents
  if (!ownerWebContents) {
    return {}
  }

  const getResolvedDependencies = async () => {
    if (
      dependencies.createSession !== undefined &&
      dependencies.getSessionOutput !== undefined &&
      dependencies.listSessions !== undefined &&
      dependencies.terminateSession !== undefined &&
      dependencies.writeToSession !== undefined
    ) {
      return dependencies as TerminalToolDependencies
    }

    const defaultDependencies = await loadDefaultTerminalToolDependencies()
    return {
      ...defaultDependencies,
      ...dependencies,
    }
  }

  const terminalExecutionMode = context.terminalExecutionMode ?? 'sandbox'

  return {
    execute_terminal: tool({
      description: getExecuteTerminalDescription(),
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          mode: {
            type: 'string',
            enum: ['execute', 'read', 'list', 'end'],
            description: 'execute: run command in background | read: read output of session | list: list sessions | end: kill session',
          },
          wait_ms: {
            type: 'number',
            description: 'Milliseconds to wait for output in read mode (max 15000). Useful to avoid spamming read.',
          },
          command: {
            type: 'string',
            description: 'Command to run. Required for execute mode.',
          },
          session_id: {
            type: 'number',
            description: 'Session ID. Required for read and end modes.',
          },
          label: {
            type: 'string',
            description: 'Human-readable label for the session (e.g. "dev server"). Optional for execute mode.',
          },
          cols: {
            minimum: 20,
            maximum: 400,
            type: 'number',
          },
          ...(terminalExecutionMode === 'full' ? {
            cwd: {
              type: 'string',
            }
          } : {}),
          rows: {
            minimum: 6,
            maximum: 200,
            type: 'number',
          },
          session_key: {
            type: 'string',
          },
        },
        required: ['mode'],
        type: 'object',
      }),
      execute: async (rawInput, options) => {
        const inputValue = rawInput as {
          mode: 'execute' | 'read' | 'list' | 'end'
          wait_ms?: number
          command?: string
          session_id?: number
          label?: string
          cols?: number
          cwd?: string
          rows?: number
          session_key?: string
        }

        const abortSignal = options?.abortSignal
        const cols = clampInteger(inputValue.cols, 20, 400, 220)
        const rows = clampInteger(inputValue.rows, 6, 200, 50)
        const waitMs = clampInteger(inputValue.wait_ms, 0, 15000, 2000)

        try {
          const resolvedDependencies = await getResolvedDependencies()
          const namespace = resolveTerminalThreadNamespace(context)
          const store = getOrCreateThreadStore(namespace)

          // ─── LIST ──────────────────────────────────────────────────────────
          if (inputValue.mode === 'list') {
            if (store.sessions.size === 0) {
              return createSuccessResult({
                body: 'No active terminal sessions in this chat context.',
                summary: 'Listed terminal sessions',
              })
            }

            const lines = Array.from(store.sessions.values()).map((s) => {
              return `[${s.localSessionId}] ${s.label ?? '(unlabeled)'} | cwd: ${s.cwd}`
            })

            return createSuccessResult({
              body: lines.join('\n'),
              summary: `Listed ${store.sessions.size} terminal session(s)`,
            })
          }

          // ─── END ───────────────────────────────────────────────────────────
          if (inputValue.mode === 'end') {
            if (typeof inputValue.session_id !== 'number') {
              return createErrorResult('session_id required for end mode.')
            }

            const session = store.sessions.get(inputValue.session_id)
            if (!session) {
              return createErrorResult(`Session ${inputValue.session_id} not found in this chat context.`)
            }

            resolvedDependencies.terminateSession(ownerWebContents, session.globalSessionId, context.workspaceRootPath)
            store.sessions.delete(inputValue.session_id)
            return createSuccessResult({
              body: `Session ${inputValue.session_id} terminated.`,
              summary: `Ended terminal session ${inputValue.session_id}`,
            })
          }

          // ─── READ ──────────────────────────────────────────────────────────
          if (inputValue.mode === 'read') {
            let targetSessionId = inputValue.session_id
            if (typeof targetSessionId !== 'number' || !store.sessions.has(targetSessionId)) {
              if (store.latestLocalSessionId !== null && store.sessions.has(store.latestLocalSessionId)) {
                targetSessionId = store.latestLocalSessionId
              } else if (store.sessions.size > 0) {
                targetSessionId = Array.from(store.sessions.keys()).pop()
              }
            }

            if (typeof targetSessionId !== 'number' || !store.sessions.has(targetSessionId)) {
              return createErrorResult('No active terminal session found to read in this chat context.')
            }

            const session = store.sessions.get(targetSessionId)!

            throwIfAborted(abortSignal)
            const snapshot = await raceWithAbort(
              resolvedDependencies.getSessionOutput(ownerWebContents, {
                pollingMs: waitMs,
                sessionId: session.globalSessionId,
                workspaceRootPath: context.workspaceRootPath,
              }),
              abortSignal,
            )

            const sanitized = sanitizeTerminalOutput(snapshot.outputBuffer)
            
            // Incremental delta reading: Return only the NEW output produced since the last read
            const newOutput = sanitized.slice(session.lastReadOffset)
            session.lastReadOffset = sanitized.length

            const truncated = truncateTerminalOutput(newOutput, session.command)

            if (context.checkpointId) {
              await captureWorkspaceCheckpointTerminalPostState(context.checkpointId, context.workspaceRootPath)
            }

            return createSuccessResult({
              body: truncated.body || 'No new output.',
              semantics: {
                has_exited: snapshot.hasExited,
                exit_code: snapshot.exitCode,
                session_id: targetSessionId,
                truncated_output: truncated.truncated,
              },
              subject: { kind: 'session', path: String(targetSessionId) },
              summary: `Read terminal session ${targetSessionId}`,
              truncated: truncated.truncated,
            })
          }

          // ─── EXECUTE ───────────────────────────────────────────────────────
          const requestedCommand = normalizeCommand(inputValue.command)
          if (!requestedCommand) {
            return createErrorResult('command required for execute mode.')
          }

          if (terminalExecutionMode === 'sandbox') {
            const cdRegex = /(?:^|[;&|]\s*)cd\s+("([^"]+)"|'([^']+)'|([^\s;&|]+))/gi
            let match
            while ((match = cdRegex.exec(requestedCommand)) !== null) {
              const targetPath = (match[2] ?? match[3] ?? match[4] ?? '').trim()

              if (targetPath.includes('..')) {
                return createErrorResult(
                  'In sandbox mode, you cannot use ".." in cd commands to traverse up directories.',
                  'Command rejected: Directory traversal (..) is not allowed in sandbox mode.',
                )
              }

              if (path.isAbsolute(targetPath)) {
                const normalizedTarget = path.normalize(targetPath).toLowerCase()
                const normalizedWorkspace = path.normalize(context.workspaceRootPath).toLowerCase()

                if (!normalizedTarget.startsWith(normalizedWorkspace)) {
                  return createErrorResult(
                    `In sandbox mode, cd to an absolute path must be within the workspace root (${context.workspaceRootPath}).`,
                    'Command rejected: cd to a path outside the workspace is not allowed in sandbox mode.',
                  )
                }
              } else if (targetPath.startsWith('/') || targetPath.startsWith('\\')) {
                return createErrorResult(
                  'In sandbox mode, cd to root-relative paths is not allowed.',
                  'Command rejected: cd to root-relative paths is not allowed in sandbox mode.',
                )
              }
            }
          }

          const command = prepareTerminalCommand(requestedCommand)!
          const cwd = resolveTerminalWorkspaceCwd(context, inputValue.cwd)

          throwIfAborted(abortSignal)

          // Capture workspace state BEFORE the command runs so revert can undo
          // any files or directories the shell creates. This must happen before
          // session creation so we don't miss anything the shell startup touches.
          if (context.checkpointId) {
            await captureWorkspaceCheckpointTerminalPreState(context.checkpointId, context.workspaceRootPath)
          }

          let localSessionId: number
          let globalSessionId: number
          let shellLabel: string

          if (typeof inputValue.session_id === 'number' && store.sessions.has(inputValue.session_id)) {
            localSessionId = inputValue.session_id
            const existing = store.sessions.get(localSessionId)!
            globalSessionId = existing.globalSessionId
            shellLabel = existing.shell
          } else {
            localSessionId = store.nextLocalSessionId++
            const aiSessionKey = `__ai__${namespace}__${localSessionId}`

            const session = await raceWithAbort(
              resolvedDependencies.createSession(ownerWebContents, {
                cols,
                cwd,
                enableIdleTimeout: true,
                isAiSession: true,
                label: inputValue.label ?? null,
                rows,
                sessionKey: aiSessionKey,
                workspaceRootPath: context.workspaceRootPath,
              }),
              abortSignal,
            )

            globalSessionId = session.sessionId
            shellLabel = session.shell
            store.sessions.set(localSessionId, {
              localSessionId,
              globalSessionId,
              label: inputValue.label ?? null,
              cwd,
              command,
              shell: shellLabel,
              lastReadOffset: 0,
            })
          }

          store.latestLocalSessionId = localSessionId

          const completionMarker = createCompletionMarker(localSessionId)
          throwIfAborted(abortSignal)

          await raceWithAbort(
            resolvedDependencies.writeToSession(ownerWebContents, {
              data: buildMarkedCommand(command, shellLabel, completionMarker),
              sessionId: globalSessionId,
            }),
            abortSignal,
          )

          // Post-state is NOT captured here because writeToSession only dispatches
          // the command — the shell hasn't run it yet. Post-state is captured in
          // the `read` branch below, after the AI polls for output (by which time
          // the command has actually finished and files/dirs exist on disk).

          return createSuccessResult({
            body: [
              `Command started in background. session_id: ${localSessionId}`,
              `Use execute_terminal with mode=read and session_id=${localSessionId} to check output.`,
              `Use execute_terminal with mode=end and session_id=${localSessionId} to stop it.`,
            ].join('\n'),
            semantics: {
              command,
              session_id: localSessionId,
              is_background: true,
            },
            subject: { kind: 'session', path: String(localSessionId) },
            summary: `Started terminal session ${localSessionId}`,
          })
        } catch (error) {
          if (abortSignal?.aborted) {
            throw toAbortError(abortSignal)
          }

          return createErrorResult(
            error instanceof Error && error.message.trim().length > 0 ? error.message : 'Terminal execution failed.',
          )
        }
      },
    }),
  }
}

export async function terminateAllBackgroundSessions(
  webContents: WebContents,
  workspaceRootPath: string,
  conversationId?: string | null,
  customTerminateSession?: (webContents: WebContents, sessionId: number, workspaceRootPath: string) => void,
) {
  const terminalService = customTerminateSession ? null : await loadDefaultTerminalToolDependencies()

  const namespacesToClean: string[] = []
  if (conversationId?.trim()) {
    namespacesToClean.push(`conversation:${conversationId.trim()}`)
  } else {
    namespacesToClean.push(...threadStores.keys())
  }

  for (const ns of namespacesToClean) {
    const store = threadStores.get(ns)
    if (!store) continue

    for (const session of store.sessions.values()) {
      try {
        if (customTerminateSession) {
          customTerminateSession(webContents, session.globalSessionId, workspaceRootPath)
        } else if (terminalService) {
          terminalService.terminateSession(webContents, session.globalSessionId, workspaceRootPath)
        }
      } catch (e) {
        // ignore
      }
    }
    threadStores.delete(ns)
  }
}
