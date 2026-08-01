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
  assertSandboxCommandWorkingDirectories,
  assertSandboxPathDoesNotEscapeThroughSymlink,
  getSandboxPathRoots,
  resolveSandboxPath,
} from './sandboxPaths'

const ANSI_ESCAPE = '\u001B'
const TERMINAL_BELL = '\u0007'
const ANSI_CSI_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-?]*[ -/]*[@-~]`, 'g')
const ANSI_OSC_PATTERN = new RegExp(`${ANSI_ESCAPE}\\][^${TERMINAL_BELL}${ANSI_ESCAPE}]*(?:${TERMINAL_BELL}|${ANSI_ESCAPE}\\\\)`, 'g')
const ANSI_SINGLE_ESCAPE_PATTERN = new RegExp(`${ANSI_ESCAPE}[@-Z\\-_]`, 'g')
const MAX_GIT_DIFF_OUTPUT_LENGTH = 20_000


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
  return 'Executes terminal commands and manages terminal sessions.'
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



function truncateTerminalOutput(value: string, command: string | null) {
  if (!isGitDiffCommand(command) || value.length <= MAX_GIT_DIFF_OUTPUT_LENGTH) {
    return {
      body: value,
      truncated: false,
    }
  }

  return {
    body: `${value.slice(0, MAX_GIT_DIFF_OUTPUT_LENGTH)}\n\n[Output truncated at ${MAX_GIT_DIFF_OUTPUT_LENGTH} characters.]`,
    truncated: true,
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
  const normalizedConversationId = typeof conversationId === 'string'
    ? conversationId.trim()
    : ''
  if (normalizedConversationId) {
    namespacesToClean.push(`conversation:${normalizedConversationId}`)
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
  if (terminalExecutionMode === 'sandbox') {
    return resolveSandboxPath(context.workspaceRootPath, cwd)
  }

  const normalizedCwd = cwd?.trim() ?? ''
  return {
    absolutePath:
      normalizedCwd.length === 0
        ? context.workspaceRootPath
        : path.resolve(context.workspaceRootPath, normalizedCwd),
    roots: getSandboxPathRoots(context.workspaceRootPath),
  }
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
            description: 'Terminal operation mode.',
          },
          wait_ms: {
            type: 'number',
            description: 'Milliseconds to wait for output in read mode.',
          },
          command: {
            type: 'string',
            description: 'Command to run.',
          },
          session_id: {
            type: 'number',
            description: 'Session ID for read or end mode.',
          },
          label: {
            type: 'string',
            description: 'Human-readable label for the session.',
          },
          cols: {
            minimum: 20,
            maximum: 400,
            type: 'number',
          },
          cwd: {
            description: 'Working directory for the command.',
            type: 'string',
          },
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
          if (!ownerWebContents) {
            return createErrorResult('Terminal execution requires an active renderer context.')
          }
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

          const command = prepareTerminalCommand(requestedCommand)!
          const resolvedCwd = resolveTerminalWorkspaceCwd(context, inputValue.cwd)
          const cwd = resolvedCwd.absolutePath
          if (terminalExecutionMode === 'sandbox') {
            try {
              const changedWorkingDirectories = assertSandboxCommandWorkingDirectories(
                command,
                context.workspaceRootPath,
                cwd,
              )
              await Promise.all(
                [cwd, ...changedWorkingDirectories].map((directoryPath) =>
                  assertSandboxPathDoesNotEscapeThroughSymlink(directoryPath, resolvedCwd.roots),
                ),
              )
            } catch (error) {
              const message =
                error instanceof Error && error.message.trim().length > 0
                  ? error.message
                  : 'Command changes to a directory outside the sandbox roots.'
              return createErrorResult(message, `Command rejected: ${message}`)
            }
          }

          throwIfAborted(abortSignal)

          let localSessionId: number
          let globalSessionId: number
          let shellLabel: string

          if (typeof inputValue.session_id === 'number' && store.sessions.has(inputValue.session_id)) {
            localSessionId = inputValue.session_id
            const existing = store.sessions.get(localSessionId)!
            globalSessionId = existing.globalSessionId
            shellLabel = existing.shell
          } else {
            const sessionOrdinal = store.nextLocalSessionId++
            const aiSessionKey = inputValue.session_key?.trim() || `__ai__${namespace}__${sessionOrdinal}`

            const session = await raceWithAbort(
              resolvedDependencies.createSession(ownerWebContents, {
                cols,
                cwd,
                enableIdleTimeout: true,
                label: inputValue.label ?? null,
                rows,
                sessionKey: aiSessionKey,
                workspaceRootPath: context.workspaceRootPath,
              }),
              abortSignal,
            )

            globalSessionId = session.sessionId
            localSessionId = globalSessionId
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
  conversationIdOrTerminate?: string | null | (
    (webContents: WebContents, sessionId: number, workspaceRootPath: string) => void
  ),
  customTerminateSession?: (webContents: WebContents, sessionId: number, workspaceRootPath: string) => void,
) {
  const conversationId = typeof conversationIdOrTerminate === 'string'
    ? conversationIdOrTerminate.trim()
    : ''
  const terminateSession = typeof conversationIdOrTerminate === 'function'
    ? conversationIdOrTerminate
    : customTerminateSession
  const terminalService = terminateSession ? null : await loadDefaultTerminalToolDependencies()

  const namespacesToClean: string[] = []
  if (conversationId) {
    namespacesToClean.push(`conversation:${conversationId}`)
  } else {
    namespacesToClean.push(...threadStores.keys())
  }

  for (const ns of namespacesToClean) {
    const store = threadStores.get(ns)
    if (!store) continue

    for (const session of store.sessions.values()) {
      try {
        if (terminateSession) {
          terminateSession(webContents, session.globalSessionId, workspaceRootPath)
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
