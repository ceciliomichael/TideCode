import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { Worker, type WorkerOptions } from 'node:worker_threads'
import type { AppTerminalExecutionMode } from '../../../../src/types/chat'
import type { AgentToolRegistry } from '../tools/registry'
import { isDynamicAgentTool } from '../tools/registry'
import type { AgentToolExecutionResult } from '../toolTypes'
import { getCodeModeToolCallStatus } from './toolCallStatus'
import {
  containsDynamicCodeModeImport,
  findBlockedCodeModeRuntimeApi,
  normalizeCodeModePatchTemplateLiterals,
  repairCodeModePatchProgram,
  repairCodeModePreloadedToolsImport,
  repairCodeModeProgramSyntax,
  validateCodeModeProgram,
} from './validation'
import {
  DEFAULT_CODE_MODE_EXECUTION_LIMITS,
  type CodeModeExecutionLimits,
  type CodeModeExecutionResult,
  type CodeModeToolCallRecord,
  type CodeModeWorkerErrorMessage,
  type CodeModeWorkerResultMessage,
  type CodeModeWorkerToolCallMessage,
  type CodeModeWorkerToolResultMessage,
} from './types'

const CODE_MODE_WORKER_SOURCE = String.raw`
const { parentPort } = await import('node:worker_threads')
const hostProcess = process
const { createRequire } = await import('node:module')
const { pathToFileURL } = await import('node:url')
const path = await import('node:path')
const hostRequire = createRequire(pathToFileURL(path.join(hostProcess.cwd(), 'tidecode-code-mode.js')))
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

const pendingToolCalls = new Map()
const pendingToolPromises = new Set()
const pendingPromiseThen = new WeakMap()
const pendingEditBatches = new Map()
const batchedToolCallIds = new Map()

function getEditBatchKey(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const keys = Object.keys(input)
  if (keys.some((key) => key !== 'path' && key !== 'edits' && key !== 'expectedRevision')) return null
  if (typeof input.path !== 'string' || input.path.trim().length === 0) return null
  if (!Array.isArray(input.edits) || input.edits.length === 0) return null
  if (input.expectedRevision !== undefined && typeof input.expectedRevision !== 'string') return null

  const normalizedPath = path.normalize(input.path)
  const comparablePath = hostProcess.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath
  return JSON.stringify([comparablePath, input.expectedRevision ?? null])
}

function postToolCall(name, input, callId, logicalCallCount = 1) {
  parentPort.postMessage({ arguments: input, callId, logicalCallCount, name, type: 'tool_call' })
}

function flushEditBatch(batchKey) {
  const batch = pendingEditBatches.get(batchKey)
  if (!batch) return
  pendingEditBatches.delete(batchKey)

  if (batch.length === 1) {
    const item = batch[0]
    postToolCall('edit', item.input, item.callId)
    return
  }

  const transportCallId = batch[0].callId
  batchedToolCallIds.set(transportCallId, batch.map((item) => item.callId))
  postToolCall('edit', {
    ...batch[0].input,
    edits: batch.flatMap((item) => item.input.edits),
  }, transportCallId, batch.length)
}

function queueEditToolCall(input, callId) {
  const batchKey = getEditBatchKey(input)
  if (batchKey === null) return false

  let batch = pendingEditBatches.get(batchKey)
  if (!batch) {
    batch = []
    pendingEditBatches.set(batchKey, batch)
    queueMicrotask(() => flushEditBatch(batchKey))
  }
  batch.push({ callId, input })
  return true
}

function trackPendingPromise(promise) {
  if (pendingToolPromises.has(promise)) return promise

  pendingToolPromises.add(promise)
  const originalThen = promise.then.bind(promise)
  pendingPromiseThen.set(promise, originalThen)
  Object.defineProperty(promise, 'then', {
    configurable: false,
    enumerable: false,
    value(onFulfilled, onRejected) {
      return trackPendingPromise(originalThen(onFulfilled, onRejected))
    },
    writable: false,
  })
  void originalThen(
    () => pendingToolPromises.delete(promise),
    () => pendingToolPromises.delete(promise),
  )
  return promise
}

function createTools(toolNames) {
  const tools = {}
  for (const name of toolNames) {
    tools[name] = (input) => {
      const callId = name + '-' + Date.now() + '-' + Math.random().toString(36).slice(2)
      const promise = new Promise((resolve, reject) => {
        pendingToolCalls.set(callId, { reject, resolve })
        if (name === 'edit' && queueEditToolCall(input, callId)) return
        postToolCall(name, input, callId)
      })
      return trackPendingPromise(promise)
    }
  }
  return Object.freeze(tools)
}

function createBlockedRuntimeApi(name) {
  const blocked = () => {
    throw new Error('Code Mode tool-only runtime blocked ' + name + '. Use the matching tools.* API instead.')
  }
  return new Proxy(blocked, {
    apply() {
      throw new Error('Code Mode tool-only runtime blocked ' + name + '. Use the matching tools.* API instead.')
    },
    get(_target, property) {
      if (property === 'name') return name
      if (property === 'toString') return () => '[tool-only-blocked-runtime-api]'
      throw new Error('Code Mode tool-only runtime blocked ' + name + '. Use the matching tools.* API instead.')
    },
  })
}


function blockToolOnlyCodeGeneration() {
  const blocked = createBlockedRuntimeApi('code generation')
  const functionPrototypes = [
    Object.getPrototypeOf(function () {}),
    Object.getPrototypeOf(async function () {}),
    Object.getPrototypeOf(function* () {}),
    Object.getPrototypeOf(async function* () {}),
  ]

  for (const prototype of new Set(functionPrototypes)) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor')
    if (!descriptor) continue
    Object.defineProperty(prototype, 'constructor', {
      ...descriptor,
      configurable: false,
      value: blocked,
      writable: false,
    })
  }
}

function configureRuntime(message) {
  if (message.executionMode === 'full') {
    globalThis.process = hostProcess
    globalThis.require = hostRequire
    globalThis.module = { exports: {} }
    globalThis.fs = hostRequire('node:fs')
    globalThis.child_process = hostRequire('node:child_process')
    globalThis.http = hostRequire('node:http')
    globalThis.https = hostRequire('node:https')
    globalThis.net = hostRequire('node:net')
    globalThis.Worker = hostRequire('node:worker_threads').Worker
    globalThis.worker_threads = hostRequire('node:worker_threads')
    return
  }

  globalThis.global = createBlockedRuntimeApi('global')
  globalThis.process = createBlockedRuntimeApi('process')
  globalThis.require = createBlockedRuntimeApi('require')
  globalThis.module = createBlockedRuntimeApi('module')
  globalThis.Buffer = createBlockedRuntimeApi('Buffer')
  globalThis.fetch = createBlockedRuntimeApi('fetch')
  globalThis.eval = createBlockedRuntimeApi('eval')
  globalThis.Function = createBlockedRuntimeApi('Function')
  globalThis.WebAssembly = createBlockedRuntimeApi('WebAssembly')
  globalThis.Worker = createBlockedRuntimeApi('Worker')
  globalThis.worker_threads = createBlockedRuntimeApi('worker_threads')
  globalThis.child_process = createBlockedRuntimeApi('child_process')
  globalThis.http = createBlockedRuntimeApi('http')
  globalThis.https = createBlockedRuntimeApi('https')
  globalThis.net = createBlockedRuntimeApi('net')
  globalThis.Electron = createBlockedRuntimeApi('Electron')
  globalThis.Bun = createBlockedRuntimeApi('Bun')
  globalThis.Deno = createBlockedRuntimeApi('Deno')
  globalThis.fs = createBlockedRuntimeApi('fs')
  globalThis.console = {
    ...globalThis.console,
    log: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    dir: () => {},
  }
  blockToolOnlyCodeGeneration()
}

function isPromiseLike(value) {
  return value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof value.then === 'function'
}

async function resolveReturnedValue(value, ancestors = new Set()) {
  if (isPromiseLike(value)) {
    return await resolveReturnedValue(await value, ancestors)
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  if (ancestors.has(value)) {
    throw new Error('Code Mode returned cyclic data. Return only JSON-compatible values.')
  }

  const nextAncestors = new Set(ancestors)
  nextAncestors.add(value)

  if (Array.isArray(value)) {
    const resolvedItems = []
    for (const item of value) {
      resolvedItems.push(await resolveReturnedValue(item, nextAncestors))
    }
    return resolvedItems
  }

  const resolvedObject = {}
  for (const key of Object.keys(value)) {
    resolvedObject[key] = await resolveReturnedValue(value[key], nextAncestors)
  }
  return resolvedObject
}

function assertCloneable(value) {
  try {
    structuredClone(value)
  } catch {
    throw new Error('Code Mode returned non-serializable data. Always await every tools.* call and return only JSON-compatible values.')
  }
  return value
}

async function drainPendingToolPromises() {
  let emptyPasses = 0
  while (emptyPasses < 2) {
    const tracked = Array.from(pendingToolPromises)
    if (tracked.length === 0) {
      emptyPasses += 1
      await Promise.resolve()
      continue
    }
    emptyPasses = 0
    const pending = tracked.map((promise) => new Promise((resolve, reject) => {
      const originalThen = pendingPromiseThen.get(promise)
      originalThen(resolve, reject)
    }))
    await Promise.all(pending)
  }
}

async function execute(message) {
  configureRuntime(message)
  const program = new AsyncFunction('tools', message.source)
  const output = await program(createTools(message.toolNames))
  await drainPendingToolPromises()
  return assertCloneable(await resolveReturnedValue(output))
}

parentPort.on('message', (message) => {
  if (message.type === 'tool_result') {
    const callIds = batchedToolCallIds.get(message.callId) ?? [message.callId]
    batchedToolCallIds.delete(message.callId)
    for (const callId of callIds) {
      const pending = pendingToolCalls.get(callId)
      if (!pending) continue
      pendingToolCalls.delete(callId)
      if (message.error) {
        const toolError = new Error(message.error)
        if (message.errorResult !== undefined) {
          const errorResult = callIds.length > 1 ? structuredClone(message.errorResult) : message.errorResult
          toolError.result = errorResult
          const semantics = errorResult && typeof errorResult === 'object'
            ? errorResult.semantics
            : undefined
          if (semantics && typeof semantics === 'object') {
            toolError.semantics = semantics
            if (typeof semantics.error_code === 'string') toolError.code = semantics.error_code
          }
        }
        pending.reject(toolError)
      } else {
        pending.resolve(callIds.length > 1 ? structuredClone(message.result) : message.result)
      }
    }
    return
  }

  if (message.type !== 'execute') return
  void execute(message)
    .then((output) => parentPort.postMessage({ output, type: 'result' }))
    .catch((error) => parentPort.postMessage({ error: error instanceof Error ? error.message : String(error), type: 'error' }))
})
`

function byteLength(value: string) {
  return Buffer.byteLength(value, 'utf8')
}

function errorResult(
  executionId: string,
  summary: string,
  toolCalls: CodeModeToolCallRecord[] = [],
  status: 'aborted' | 'error' = 'error',
): CodeModeExecutionResult {
  return {
    error: summary,
    executionId,
    status,
    summary,
    toolCalls,
    truncated: false,
  }
}

function toJsonSafe(value: unknown): unknown {
  if (value === undefined) {
    return undefined
  }

  try {
    const serialized = JSON.stringify(value, (_key, nestedValue: unknown) => {
      if (typeof nestedValue === 'bigint') return `${nestedValue}n`
      if (nestedValue instanceof Uint8Array) return Array.from(nestedValue)
      return nestedValue
    })
    return serialized === undefined ? undefined : JSON.parse(serialized)
  } catch {
    return String(value)
  }
}

const CODE_MODE_HIDDEN_MODEL_SEMANTIC_KEYS = new Set([
  'active',
  'available_line_count',
  'broker_session_id',
  'first_available_line',
  'has_more',
  'is_directory',
  'last_available_line',
  'line_count',
  'new_output_line_count',
  'omitted_bytes',
  'omitted_lines',
  'operation_id',
  'original_approximate_tokens',
  'returned_line_count',
  'total_output_lines',
  'visible_line_ranges',
  'wait_seconds',
])

function projectCodeModeModelSemantics(semantics: Record<string, unknown> | undefined) {
  if (!semantics) return undefined
  const projected = Object.fromEntries(
    Object.entries(semantics).filter(([key]) => !CODE_MODE_HIDDEN_MODEL_SEMANTIC_KEYS.has(key)),
  )
  return Object.keys(projected).length > 0 ? projected : undefined
}

function serializeToolResult(result: AgentToolExecutionResult): unknown {
  const modelSource = { ...result }
  delete modelSource.displayBody
  delete modelSource.modelOutput
  delete modelSource.resultPresentation
  delete modelSource.truncated
  const projectedSemantics = projectCodeModeModelSemantics(result.semantics)
  if (projectedSemantics) modelSource.semantics = projectedSemantics
  else delete modelSource.semantics
  const modelResult = toJsonSafe(modelSource) as Record<string, unknown>
  const semantics = asRecord(modelResult.semantics)
  if (modelResult.session_id === undefined && typeof semantics?.session_id === 'number') {
    modelResult.session_id = semantics.session_id
  }
  if (modelResult.exit_code === undefined && typeof semantics?.exit_code === 'number') {
    modelResult.exit_code = semantics.exit_code
  }
  return modelResult
}

function capDisplayBody(result: AgentToolExecutionResult) {
  return result.displayBody ?? result.body
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

const RECOVERABLE_INSPECTION_TOOLS = new Set(['glob', 'grep', 'list', 'read'])

function isRecoverableToolResult(name: string, result: AgentToolExecutionResult) {
  if (result.status !== 'error') return false
  return RECOVERABLE_INSPECTION_TOOLS.has(name) || (
    name === 'edit' && result.semantics?.recoverable === true
  )
}

function isRecoverableToolCall(toolCall: CodeModeToolCallRecord) {
  if (toolCall.status !== 'error') return false
  return RECOVERABLE_INSPECTION_TOOLS.has(toolCall.name) || (
    toolCall.name === 'edit' && toolCall.semantics?.recoverable === true
  )
}

function capExecutionOutput(output: unknown, maxBytes: number) {
  const safeOutput = toJsonSafe(output)
  if (safeOutput === undefined) {
    return { output: undefined, outputTruncated: false }
  }

  const serialized = JSON.stringify(safeOutput)
  if (byteLength(serialized) <= maxBytes) {
    return { output: safeOutput, outputTruncated: false }
  }

  return {
    output: {
      message: `Code Mode output exceeded the ${maxBytes}-byte limit. Return a smaller summary from the program.`,
    },
    outputTruncated: true,
  }
}

export class CodeModeExecutor {
  private readonly activeWorkers = new Set<Worker>()
  private readonly executionMode: AppTerminalExecutionMode
  private readonly preloadedToolNames: readonly string[]
  private readonly workspaceRootPath: string

  public constructor(
    private readonly registry: AgentToolRegistry,
    preloadedToolNames?: readonly string[],
    options: {
      terminalExecutionMode?: AppTerminalExecutionMode
      workspaceRootPath?: string
    } = {},
  ) {
    this.executionMode = options.terminalExecutionMode ?? 'sandbox'
    this.preloadedToolNames = preloadedToolNames ?? registry.entries
      .filter((entry) => !isDynamicAgentTool(entry))
      .map((entry) => entry.name)
    this.workspaceRootPath = path.resolve(options.workspaceRootPath ?? process.cwd())
  }

  public async run(
    source: string,
    options: {
      abortSignal?: AbortSignal
      allowedToolNames?: readonly string[]
      limits?: Partial<CodeModeExecutionLimits>
    } = {},
  ): Promise<CodeModeExecutionResult> {
    const limits = { ...DEFAULT_CODE_MODE_EXECUTION_LIMITS, ...options.limits }
    const executionId = randomUUID()
    let executableCode = normalizeCodeModePatchTemplateLiterals(source)
    let validationError = validateCodeModeProgram(executableCode, limits.maxCodeBytes)
    if (validationError?.includes('invalid JavaScript') === true) {
      const repairedCode = repairCodeModePatchProgram(executableCode) ?? repairCodeModeProgramSyntax(executableCode)
      if (repairedCode !== null) {
        const repairedValidationError = validateCodeModeProgram(repairedCode, limits.maxCodeBytes)
        if (repairedValidationError === null) {
          executableCode = repairedCode
          validationError = null
        } else {
          validationError = repairedValidationError
        }
      }
    }
    if (validationError) return errorResult(executionId, validationError)
    if (options.abortSignal?.aborted) return errorResult(executionId, 'Code Mode execution was aborted.', [], 'aborted')

    const toolNames = Array.from(new Set(
      options.allowedToolNames ?? this.preloadedToolNames,
    ))
    const allowedToolNameSet = options.allowedToolNames
      ? new Set(toolNames)
      : null
    const unavailableToolName = toolNames.find((name) => !this.registry.get(name))
    if (unavailableToolName) {
      return errorResult(executionId, `Tool "${unavailableToolName}" is not available in the Code Mode registry.`)
    }

    type ModuleWorkerOptions = WorkerOptions & { type: 'module' }
    const workerOptions: ModuleWorkerOptions = { eval: true, type: 'module', stdout: true, stderr: true }
    if (this.executionMode === 'sandbox') {
      const repairedToolsImport = repairCodeModePreloadedToolsImport(executableCode)
      if (repairedToolsImport !== null && validateCodeModeProgram(repairedToolsImport, limits.maxCodeBytes) === null) {
        executableCode = repairedToolsImport
      }
      if (containsDynamicCodeModeImport(executableCode)) {
        return errorResult(executionId, 'Code Mode tool-only runtime does not allow dynamic module loading. No tool ran. Use the available tools.* APIs instead.')
      }
      const blockedRuntimeApi = findBlockedCodeModeRuntimeApi(executableCode)
      if (blockedRuntimeApi !== null) {
        return errorResult(
          executionId,
          `Code Mode tool-only runtime blocked ${blockedRuntimeApi} before execution. No tool ran. Use the matching tools.* API instead.`,
        )
      }
      const nodeMajorVersion = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10)
      if (!Number.isInteger(nodeMajorVersion) || nodeMajorVersion < 20) {
        return errorResult(executionId, 'Code Mode tool-only runtime requires Node.js permission support.')
      }
      workerOptions.execArgv = ['--permission']
    }

    const worker = new Worker(CODE_MODE_WORKER_SOURCE, workerOptions)
    this.activeWorkers.add(worker)
    const executionAbortController = new AbortController()
    const toolCalls: CodeModeToolCallRecord[] = []
    let acceptedToolCallCount = 0
    let inFlightToolCallCount = 0
    let workerCompletionReceived = false
    let pendingWorkerCompletion: CodeModeWorkerResultMessage | CodeModeWorkerErrorMessage | undefined
    let settled = false
    let timeoutId: NodeJS.Timeout | undefined
    let abortHandler: (() => void) | undefined

    const settle = async (): Promise<void> => {
      if (settled) return
      settled = true
      if (!executionAbortController.signal.aborted) executionAbortController.abort()
      if (timeoutId) clearTimeout(timeoutId)
      if (abortHandler && options.abortSignal) options.abortSignal.removeEventListener('abort', abortHandler)
      this.activeWorkers.delete(worker)
      await worker.terminate().catch(() => undefined)
    }

    return await new Promise<CodeModeExecutionResult>((resolve) => {
      const finish = (result: CodeModeExecutionResult) => {
        void settle().then(() => resolve(result))
      }

      const finishWorkerCompletion = (message: CodeModeWorkerResultMessage | CodeModeWorkerErrorMessage) => {
        if (message.type === 'error') {
          finish(errorResult(executionId, `Code Mode failed: ${message.error}`, toolCalls))
          return
        }

        const output = capExecutionOutput(message.output, limits.maxOutputBytes)
        const failedToolCalls = toolCalls.filter((toolCall) => toolCall.status === 'error')
        const fatalFailedToolCalls = failedToolCalls.filter((toolCall) => !isRecoverableToolCall(toolCall))
        if (fatalFailedToolCalls.length > 0) {
          const failureCount = fatalFailedToolCalls.length
          finish({
            error: `Code Mode completed with ${failureCount} failed tool call${failureCount === 1 ? '' : 's'}.`,
            executionId,
            output: output.output,
            outputTruncated: output.outputTruncated,
            status: 'error',
            summary: `Code Mode finished with ${failureCount} failed tool call${failureCount === 1 ? '' : 's'}.`,
            toolCalls,
            truncated: output.outputTruncated,
          })
          return
        }

        const recoverableFailureCount = failedToolCalls.length
        finish({
          executionId,
          output: output.output,
          outputTruncated: output.outputTruncated,
          status: 'success',
          summary: recoverableFailureCount > 0
            ? `Code Mode completed with ${recoverableFailureCount} recoverable tool failure${recoverableFailureCount === 1 ? '' : 's'}; inspect the structured results and retry with exact context.`
            : `Code Mode completed with ${toolCalls.length} tool call${toolCalls.length === 1 ? '' : 's'}.`,
          toolCalls,
          truncated: output.outputTruncated,
        })
      }

      const maybeFinishWorkerCompletion = () => {
        if (settled || inFlightToolCallCount > 0 || !pendingWorkerCompletion) return
        const completion = pendingWorkerCompletion
        pendingWorkerCompletion = undefined
        finishWorkerCompletion(completion)
      }

      if (typeof limits.timeoutMs === 'number' && limits.timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          if (!executionAbortController.signal.aborted) executionAbortController.abort()
          finish(errorResult(executionId, `Code Mode execution exceeded the ${limits.timeoutMs}ms timeout.`, toolCalls))
        }, limits.timeoutMs)
      }
      abortHandler = () => {
        if (!executionAbortController.signal.aborted) executionAbortController.abort(options.abortSignal?.reason)
        finish(errorResult(executionId, 'Code Mode execution was aborted.', toolCalls, 'aborted'))
      }
      options.abortSignal?.addEventListener('abort', abortHandler, { once: true })
      if (options.abortSignal?.aborted) abortHandler()

      worker.on('message', (message: CodeModeWorkerResultMessage | CodeModeWorkerErrorMessage | CodeModeWorkerToolCallMessage) => {
        if (settled) return
        if (message.type === 'result' || message.type === 'error') {
          workerCompletionReceived = true
          pendingWorkerCompletion = message
          maybeFinishWorkerCompletion()
          return
        }

        if (message.type !== 'tool_call') return
        if (workerCompletionReceived) {
          worker.postMessage({
            callId: message.callId,
            error: 'Code Mode execution already completed.',
            type: 'tool_result',
          } satisfies CodeModeWorkerToolResultMessage)
          return
        }
        const logicalCallCount = typeof message.logicalCallCount === 'number' &&
          Number.isInteger(message.logicalCallCount) &&
          message.logicalCallCount > 0
          ? message.logicalCallCount
          : 1
        if (acceptedToolCallCount + logicalCallCount > limits.maxToolCalls) {
          const response: CodeModeWorkerToolResultMessage = {
            callId: message.callId,
            error: `Code Mode exceeded the ${limits.maxToolCalls}-tool-call limit.`,
            type: 'tool_result',
          }
          worker.postMessage(response)
          return
        }
        if (allowedToolNameSet && !allowedToolNameSet.has(message.name)) {
          worker.postMessage({
            callId: message.callId,
            error: 'Tool "' + message.name + '" is not permitted for this Code Mode execution.',
            type: 'tool_result',
          } satisfies CodeModeWorkerToolResultMessage)
          return
        }
        const entry = this.registry.get(message.name)
        if (!entry) {
          worker.postMessage({
            callId: message.callId,
            error: `Tool "${message.name}" is not available in the Code Mode registry.`,
            type: 'tool_result',
          } satisfies CodeModeWorkerToolResultMessage)
          return
        }

        acceptedToolCallCount += logicalCallCount
        inFlightToolCallCount += 1
        const toolStartedAt = Date.now()
        void entry.execute(message.arguments, {
          abortSignal: executionAbortController.signal,
          toolCallId: `${executionId}-${message.callId}`,
        }).then((result) => {
          const toolCallStatus = getCodeModeToolCallStatus(result)
          toolCalls.push({
            arguments: toJsonSafe(message.arguments),
            body: capDisplayBody(result),
            durationMs: Date.now() - toolStartedAt,
            name: message.name,
            ...(result.resultPresentation
              ? { resultPresentation: toJsonSafe(result.resultPresentation) as CodeModeToolCallRecord['resultPresentation'] }
              : {}),
            ...(result.semantics
              ? { semantics: asRecord(toJsonSafe(result.semantics)) }
              : {}),
            status: toolCallStatus,
            ...(result.subject
              ? { subject: asRecord(toJsonSafe(result.subject)) as CodeModeToolCallRecord['subject'] }
              : {}),
            summary: result.summary,
          })
          if (settled) return
          if (result.status === 'error') {
            if (isRecoverableToolResult(message.name, result)) {
              worker.postMessage({
                callId: message.callId,
                result: serializeToolResult(result),
                type: 'tool_result',
              } satisfies CodeModeWorkerToolResultMessage)
              return
            }

            worker.postMessage({
              callId: message.callId,
              error: result.summary || capDisplayBody(result) || `Tool "${message.name}" failed.`,
              errorResult: serializeToolResult(result),
              type: 'tool_result',
            } satisfies CodeModeWorkerToolResultMessage)
            return
          }

          worker.postMessage({
            callId: message.callId,
            result: serializeToolResult(result),
            type: 'tool_result',
          } satisfies CodeModeWorkerToolResultMessage)
        }).catch((error: unknown) => {
          toolCalls.push({
            arguments: toJsonSafe(message.arguments),
            body: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - toolStartedAt,
            name: message.name,
            status: 'error',
            summary: error instanceof Error ? error.message : String(error),
          })
          if (settled) return
          worker.postMessage({
            callId: message.callId,
            error: error instanceof Error ? error.message : String(error),
            type: 'tool_result',
          } satisfies CodeModeWorkerToolResultMessage)
        }).finally(() => {
          inFlightToolCallCount = Math.max(0, inFlightToolCallCount - 1)
          maybeFinishWorkerCompletion()
        })
      })
      worker.on('error', (error) => finish(errorResult(executionId, `Code Mode worker failed: ${error.message}`, toolCalls)))
      worker.on('exit', (exitCode) => {
        if (!settled && exitCode !== 0) finish(errorResult(executionId, `Code Mode worker exited with code ${exitCode}.`, toolCalls))
      })
      worker.postMessage({
        executionMode: this.executionMode,
        limits,
        source: executableCode,
        toolNames,
        type: 'execute',
        workspaceRootPath: this.workspaceRootPath,
      })
    })
  }

  public async dispose() {
    await Promise.all(Array.from(this.activeWorkers, (worker) => worker.terminate()))
    this.activeWorkers.clear()
  }
}
