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
import { resolveReadableTargetPath } from './workspaceTools'
const DEFAULT_TERMINAL_OUTPUT_BODY_LENGTH = 40_000
const GIT_DIFF_TERMINAL_OUTPUT_BODY_LENGTH = 20_000
const ANSI_ESCAPE = '\u001B'
const TERMINAL_BELL = '\u0007'
const ANSI_CSI_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-?]*[ -/]*[@-~]`, 'g')
const ANSI_OSC_PATTERN = new RegExp(`${ANSI_ESCAPE}\\][^${TERMINAL_BELL}${ANSI_ESCAPE}]*(?:${TERMINAL_BELL}|${ANSI_ESCAPE}\\\\)`, 'g')
const ANSI_SINGLE_ESCAPE_PATTERN = new RegExp(`${ANSI_ESCAPE}[@-Z\\-_]`, 'g')

interface TerminalThreadSessionState {
  nextSessionId: number
}

// Background sessions: sessionId -> label for AI tracking
const backgroundSessions = new Map<number, string>()

const terminalThreadSessionStates = new Map<string, TerminalThreadSessionState>()

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

  const strictWarning = ' Only use when explicitly requested by the user.'

  return [
    `Manage terminal sessions. mode parameter controls action:`,
    `- execute: Run a command in background. Returns session_id immediately. Use for long-running commands (npm run dev, etc).`,
    `- read: Read output from a background session by session_id.`,
    `- list: List all active terminal sessions.`,
    `- end: Kill a terminal session by session_id.`,
    osHint,
    strictWarning,
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

function getTerminalOutputBodyLimit(command: string | null) {
  return isGitDiffCommand(command) ? GIT_DIFF_TERMINAL_OUTPUT_BODY_LENGTH : DEFAULT_TERMINAL_OUTPUT_BODY_LENGTH
}

function getTerminalOutputTruncationMessage(command: string | null, maxLength: number) {
  if (isGitDiffCommand(command)) {
    return `Output truncated at ${maxLength} characters. For large diffs, prefer \`git diff --stat\`, \`git diff --name-only\`, or a path-scoped diff.`
  }

  return `Output truncated at ${maxLength} characters.`
}

function truncateTerminalOutput(value: string, command: string | null) {
  const maxLength = getTerminalOutputBodyLimit(command)

  if (value.length <= maxLength) {
    return {
      body: value,
      truncated: false,
    }
  }

  return {
    body: `${value.slice(0, maxLength).trimEnd()}\n\n(${getTerminalOutputTruncationMessage(command, maxLength)})`,
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

function getTerminalThreadSessionState(namespace: string): TerminalThreadSessionState {
  const existingState = terminalThreadSessionStates.get(namespace)
  if (existingState) {
    return existingState
  }

  const newState: TerminalThreadSessionState = { nextSessionId: 1 }
  terminalThreadSessionStates.set(namespace, newState)
  return newState
}

function reserveThreadLocalSessionId(namespace: string) {
  const state = getTerminalThreadSessionState(namespace)
  const localSessionId = state.nextSessionId
  state.nextSessionId += 1
  return localSessionId
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



// Removed waitForCommandCompletion

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

          // ─── LIST ──────────────────────────────────────────────────────────
          if (inputValue.mode === 'list') {
            const sessionList = resolvedDependencies.listSessions(ownerWebContents, context.workspaceRootPath)
            if (sessionList.length === 0) {
              return createSuccessResult({
                body: 'No active terminal sessions.',
                summary: 'Listed terminal sessions',
              })
            }

            const lines = sessionList.map((s) => {
              const idleSec = Math.floor((Date.now() - s.lastReadAt) / 1000)
              const status = s.hasExited ? 'exited' : 'running'
              return `[${s.sessionId}] ${s.label ?? '(unlabeled)'} | ${status} | cwd: ${s.cwd} | idle: ${idleSec}s`
            })

            return createSuccessResult({
              body: lines.join('\n'),
              summary: `Listed ${sessionList.length} terminal session(s)`,
            })
          }

          // ─── END ───────────────────────────────────────────────────────────
          if (inputValue.mode === 'end') {
            if (typeof inputValue.session_id !== 'number') {
              return createErrorResult('session_id required for end mode.')
            }

            resolvedDependencies.terminateSession(ownerWebContents, inputValue.session_id, context.workspaceRootPath)
            backgroundSessions.delete(inputValue.session_id)
            return createSuccessResult({
              body: `Session ${inputValue.session_id} terminated.`,
              summary: `Ended terminal session ${inputValue.session_id}`,
            })
          }

          // ─── READ ──────────────────────────────────────────────────────────
          if (inputValue.mode === 'read') {
            if (typeof inputValue.session_id !== 'number') {
              return createErrorResult('session_id required for read mode.')
            }

            throwIfAborted(abortSignal)
            const snapshot = await raceWithAbort(
              resolvedDependencies.getSessionOutput(ownerWebContents, {
                pollingMs: waitMs,
                sessionId: inputValue.session_id,
                workspaceRootPath: context.workspaceRootPath,
              }),
              abortSignal,
            )

            const trackedCommand = backgroundSessions.get(inputValue.session_id) ?? null
            const sanitized = sanitizeTerminalOutput(snapshot.outputBuffer)
            const truncated = truncateTerminalOutput(sanitized, trackedCommand)

            return createSuccessResult({
              body: truncated.body || 'No output yet.',
              semantics: {
                has_exited: snapshot.hasExited,
                exit_code: snapshot.exitCode,
                session_id: inputValue.session_id,
                truncated_output: truncated.truncated,
              },
              subject: { kind: 'session', path: String(inputValue.session_id) },
              summary: `Read terminal session ${inputValue.session_id}`,
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
          const namespace = resolveTerminalThreadNamespace(context)
          const reservedLocalSessionId = reserveThreadLocalSessionId(namespace)

          throwIfAborted(abortSignal)
          const session = await raceWithAbort(
            resolvedDependencies.createSession(ownerWebContents, {
              cols,
              cwd,
              enableIdleTimeout: true,
              label: inputValue.label ?? null,
              rows,
              sessionKey: inputValue.session_key,
              workspaceRootPath: context.workspaceRootPath,
            }),
            abortSignal,
          )

          const completionMarker = createCompletionMarker(reservedLocalSessionId)
          throwIfAborted(abortSignal)
          await raceWithAbort(
            resolvedDependencies.writeToSession(ownerWebContents, {
              data: buildMarkedCommand(command, session.shell, completionMarker),
              sessionId: session.sessionId,
            }),
            abortSignal,
          )

          // Fire-and-forget: do not wait for completion at all. Return session ID immediately.
          backgroundSessions.set(session.sessionId, inputValue.label ?? command)

          return createSuccessResult({
            body: [
              `Command started in background. session_id: ${session.sessionId}`,
              `Use execute_terminal with mode=read and session_id=${session.sessionId} to check output.`,
              `Use execute_terminal with mode=end and session_id=${session.sessionId} to stop it.`,
            ].join('\n'),
            semantics: {
              command,
              session_id: session.sessionId,
              is_background: true,
            },
            subject: { kind: 'session', path: String(session.sessionId) },
            summary: `Started terminal session ${session.sessionId}`,
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
  customTerminateSession?: (webContents: WebContents, sessionId: number, workspaceRootPath: string) => void,
) {
  if (customTerminateSession) {
    for (const sessionId of backgroundSessions.keys()) {
      try {
        customTerminateSession(webContents, sessionId, workspaceRootPath)
      } catch (e) {
        // ignore
      }
    }
  } else {
    try {
      const terminalService = await loadDefaultTerminalToolDependencies()
      for (const sessionId of backgroundSessions.keys()) {
        try {
          terminalService.terminateSession(webContents, sessionId, workspaceRootPath)
        } catch (e) {
          // ignore
        }
      }
    } catch (e) {
      // ignore
    }
  }
  backgroundSessions.clear()
  terminalThreadSessionStates.clear()
}
