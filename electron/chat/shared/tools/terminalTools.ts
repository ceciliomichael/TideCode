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
import type { TerminalSessionSnapshot } from '../../../terminal/service'
import { resolveReadableTargetPath } from './workspaceTools'
import { notifyWorkspaceExplorerChange } from '../../../workspace/explorerNotifications'

const DEFAULT_TERMINAL_OUTPUT_BODY_LENGTH = 40_000
const GIT_DIFF_TERMINAL_OUTPUT_BODY_LENGTH = 20_000
const RUN_TERMINAL_MAX_POLLING_MS = 180_000
const RUN_TERMINAL_POLLING_INTERVAL_MS = 500
const ANSI_ESCAPE = '\\u001B'
const TERMINAL_BELL = '\\u0007'
const ANSI_CSI_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-?]*[ -/]*[@-~]`, 'g')
const ANSI_OSC_PATTERN = new RegExp(`${ANSI_ESCAPE}\\][^${TERMINAL_BELL}${ANSI_ESCAPE}]*(?:${TERMINAL_BELL}|${ANSI_ESCAPE}\\\\)`, 'g')
const ANSI_SINGLE_ESCAPE_PATTERN = new RegExp(`${ANSI_ESCAPE}[@-Z\\-_]`, 'g')

interface TerminalThreadSessionState {
  nextSessionId: number
}

interface TerminalCommandPollResult {
  commandExitCode: number | null
  completedByMarker: boolean
  snapshot: TerminalSessionSnapshot
  timedOut: boolean
}

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

function getRunTerminalDescription(terminalExecutionMode: AgentToolContext['terminalExecutionMode']) {
  const osHint = process.platform === 'win32' 
    ? ' Note: The shell is PowerShell. Use PowerShell syntax.'
    : ''

  const strictWarning = ' LAST RESORT: ONLY use this tool when explicitly requested by the user. Do not run commands on your own initiative.'

  if (terminalExecutionMode === 'full') {
    return `Execute a terminal command. You have full access and may execute commands anywhere. Use cwd to change directory. Command execution is non-interactive.${osHint}${strictWarning}`
  }

  return `Execute a terminal command. You are restricted to executing commands ONLY within the current workspace directory. Command execution is non-interactive.${osHint}${strictWarning}`
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

function getSessionIdLabel(sessionId: number) {
  return `session ${sessionId}`
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

  const nextState: TerminalThreadSessionState = {
    nextSessionId: 1,
  }
  terminalThreadSessionStates.set(namespace, nextState)
  return nextState
}

function reserveThreadLocalSessionId(namespace: string) {
  const state = getTerminalThreadSessionState(namespace)
  const localSessionId = state.nextSessionId
  state.nextSessionId += 1
  return localSessionId
}

function createCompletionMarker(localSessionId: number) {
  return `__ECHOSPHERE_COMMAND_DONE_${localSessionId}_${Date.now()}__`
}

function buildMarkedCommand(command: string, shellLabel: string, marker: string) {
  const normalizedShellLabel = shellLabel.toLowerCase()
  const trimmedCommand = command.trimEnd()

  if (normalizedShellLabel.includes('powershell') || normalizedShellLabel.includes('pwsh')) {
    return `${trimmedCommand}; $__echosphereExitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }; Write-Output "${marker}:$__echosphereExitCode"\r`
  }

  if (normalizedShellLabel.includes('command prompt') || normalizedShellLabel === 'cmd' || normalizedShellLabel.includes('cmd.exe')) {
    return `${trimmedCommand} & echo ${marker}:%ERRORLEVEL%\r`
  }

  return `${trimmedCommand}; printf '\\n${marker}:%s\\n' "$?"\r`
}

function parseCompletionMarker(output: string, marker: string) {
  const markerPattern = new RegExp(`${marker}:(-?\\d+)`)
  const match = output.match(markerPattern)
  if (!match) {
    return {
      commandExitCode: null,
      completedByMarker: false,
    }
  }

  const parsedExitCode = Number.parseInt(match[1], 10)
  return {
    commandExitCode: Number.isFinite(parsedExitCode) ? parsedExitCode : null,
    completedByMarker: true,
  }
}

function removeCompletionMarkerLines(output: string, marker: string) {
  return output
    .split('\n')
    .filter((line) => !line.includes(marker))
    .join('\n')
    .trimEnd()
}

function getRunTerminalBody(
  outputBody: string,
  input: {
    command: string | null
    snapshot?: TerminalSessionSnapshot
  },
) {
  if (outputBody.trim().length > 0) {
    return outputBody
  }

  if (input.command && input.snapshot?.hasExited) {
    return 'Terminal process exited with no output.'
  }

  return 'No terminal output yet.'
}

async function waitForCommandOutput(input: {
  abortSignal: AbortSignal | undefined
  dependencies: TerminalToolDependencies
  marker: string
  ownerWebContents: WebContents
  sessionId: number
  workspaceRootPath: string
}): Promise<TerminalCommandPollResult> {
  const deadlineMs = Date.now() + RUN_TERMINAL_MAX_POLLING_MS
  let latestSnapshot: TerminalSessionSnapshot | null = null

  while (Date.now() <= deadlineMs) {
    throwIfAborted(input.abortSignal)
    const remainingMs = Math.max(0, deadlineMs - Date.now())
    const pollingMs = Math.min(RUN_TERMINAL_POLLING_INTERVAL_MS, remainingMs)
    const snapshot = await raceWithAbort(
      input.dependencies.getSessionOutput(input.ownerWebContents, {
        pollingMs,
        sessionId: input.sessionId,
        workspaceRootPath: input.workspaceRootPath,
      }),
      input.abortSignal,
    )
    latestSnapshot = snapshot
    const sanitizedOutput = sanitizeTerminalOutput(snapshot.outputBuffer)
    const markerState = parseCompletionMarker(sanitizedOutput, input.marker)

    if (markerState.completedByMarker || snapshot.hasExited) {
      return {
        ...markerState,
        snapshot,
        timedOut: false,
      }
    }
  }

  if (!latestSnapshot) {
    latestSnapshot = await raceWithAbort(
      input.dependencies.getSessionOutput(input.ownerWebContents, {
        pollingMs: 0,
        sessionId: input.sessionId,
        workspaceRootPath: input.workspaceRootPath,
      }),
      input.abortSignal,
    )
  }

  const markerState = parseCompletionMarker(sanitizeTerminalOutput(latestSnapshot.outputBuffer), input.marker)
  return {
    ...markerState,
    snapshot: latestSnapshot,
    timedOut: !markerState.completedByMarker && !latestSnapshot.hasExited,
  }
}

function buildRunTerminalResult(input: {
  command: string | null
  commandExitCode?: number | null
  completedByMarker?: boolean
  initialSession: CreateTerminalSessionResult
  localSessionId: number
  outputMarker?: string
  snapshot?: TerminalSessionSnapshot
  timedOut?: boolean
}) {
  const outputSource = input.snapshot?.outputBuffer ?? input.initialSession.bufferedOutput
  const sanitizedOutput = sanitizeTerminalOutput(outputSource)
  const outputWithoutMarker = input.outputMarker
    ? removeCompletionMarkerLines(sanitizedOutput, input.outputMarker)
    : sanitizedOutput
  const truncatedOutput = truncateTerminalOutput(outputWithoutMarker, input.command)
  const body = getRunTerminalBody(truncatedOutput.body, {
    command: input.command,
    snapshot: input.snapshot,
  })

  const hasExited = input.snapshot?.hasExited ?? false
  const commandCompleted = input.completedByMarker === true || hasExited

  return createSuccessResult({
    body,
    semantics: {
      command: input.command,
      command_completed: input.command ? commandCompleted : null,
      command_exit_code: input.commandExitCode ?? null,
      exit_code: input.snapshot?.exitCode ?? null,
      has_exited: hasExited,
      session_id: input.localSessionId,
      signal: input.snapshot?.signal ?? null,
      timed_out: input.timedOut ?? false,
      truncated_output: truncatedOutput.truncated,
    },
    subject: {
      kind: 'session',
      path: String(input.localSessionId),
    },
    summary: input.command
      ? `Ran terminal ${getSessionIdLabel(input.localSessionId)}`
      : `Opened terminal ${getSessionIdLabel(input.localSessionId)}`,
    truncated: truncatedOutput.truncated,
  })
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
    run_terminal: tool({
      description: getRunTerminalDescription(terminalExecutionMode),
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          cols: {
            minimum: 20,
            maximum: 400,
            type: 'number',
          },
          command: {
            type: 'string',
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
        required: ['cols', 'rows'],
        type: 'object',
      }),
      execute: async (rawInput, options) => {
        const inputValue = rawInput as {
          cols: number
          command?: string
          cwd?: string
          rows: number
          session_key?: string
        }
        const abortSignal = options?.abortSignal
        const cols = clampInteger(inputValue.cols, 20, 400, 120)
        const rows = clampInteger(inputValue.rows, 6, 200, 30)
        const requestedCommand = normalizeCommand(inputValue.command)

        try {
          if (terminalExecutionMode === 'sandbox' && requestedCommand) {
            const cdRegex = /(?:^|[;&|]\s*)cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)/gi
            let match
            while ((match = cdRegex.exec(requestedCommand)) !== null) {
              let targetPath = match[1]
              if (
                (targetPath.startsWith('"') && targetPath.endsWith('"')) ||
                (targetPath.startsWith("'") && targetPath.endsWith("'"))
              ) {
                targetPath = targetPath.slice(1, -1)
              }

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

          const command = prepareTerminalCommand(requestedCommand)

          const cwd = resolveTerminalWorkspaceCwd(context, inputValue.cwd)
          const namespace = resolveTerminalThreadNamespace(context)
          const reservedLocalSessionId = reserveThreadLocalSessionId(namespace)
          const resolvedDependencies = await getResolvedDependencies()
          throwIfAborted(abortSignal)
          const session = await raceWithAbort(
            resolvedDependencies.createSession(ownerWebContents, {
              cols,
              cwd,
              rows,
              sessionKey: inputValue.session_key,
              workspaceRootPath: context.workspaceRootPath,
            }),
            abortSignal,
          )

          if (!command) {
            return buildRunTerminalResult({
              command,
              initialSession: session,
              localSessionId: reservedLocalSessionId,
            })
          }

          const completionMarker = createCompletionMarker(reservedLocalSessionId)
          throwIfAborted(abortSignal)
          await raceWithAbort(
            resolvedDependencies.writeToSession(ownerWebContents, {
              data: buildMarkedCommand(command, session.shell, completionMarker),
              sessionId: session.sessionId,
            }),
            abortSignal,
          )

          const pollResult = await waitForCommandOutput({
            abortSignal,
            dependencies: resolvedDependencies,
            marker: completionMarker,
            ownerWebContents,
            sessionId: session.sessionId,
            workspaceRootPath: context.workspaceRootPath,
          })

          notifyWorkspaceExplorerChange(context.workspaceRootPath)

          return buildRunTerminalResult({
            command,
            commandExitCode: pollResult.commandExitCode,
            completedByMarker: pollResult.completedByMarker,
            initialSession: session,
            localSessionId: reservedLocalSessionId,
            outputMarker: completionMarker,
            snapshot: {
              ...pollResult.snapshot,
              sessionId: reservedLocalSessionId,
            },
            timedOut: pollResult.timedOut,
          })
        } catch (error) {
          if (abortSignal?.aborted) {
            throw toAbortError(abortSignal)
          }

          return createErrorResult(
            error instanceof Error && error.message.trim().length > 0 ? error.message : 'Terminal run failed.',
          )
        }
      },
    }),
  }
}
