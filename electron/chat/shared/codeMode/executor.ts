import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import type { AgentToolRegistry } from '../tools/registry'
import { isDynamicAgentTool } from '../tools/registry'
import type { AgentToolExecutionResult } from '../toolTypes'
import { repairCodeModePatchProgram, repairCodeModeProgramSyntax, validateCodeModeProgram } from './validation'
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
const { parentPort } = require('node:worker_threads')
const vm = require('node:vm')

const pendingToolCalls = new Map()
const pendingToolPromises = new Set()

function createTools(toolNames) {
  const tools = {}
  for (const name of toolNames) {
    tools[name] = (input) => {
      const callId = name + '-' + Date.now() + '-' + Math.random().toString(36).slice(2)
      const promise = new Promise((resolve, reject) => {
        pendingToolCalls.set(callId, { reject, resolve })
        parentPort.postMessage({ arguments: input, callId, name, type: 'tool_call' })
      })
      pendingToolPromises.add(promise)
      void promise.then(
        () => pendingToolPromises.delete(promise),
        () => pendingToolPromises.delete(promise),
      )
      return promise
    }
  }
  return Object.freeze(tools)
}

function createSandbox(toolNames) {
  return vm.createContext({
    Array,
    Boolean,
    Date,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    RegExp,
    Set,
    String,
    tools: createTools(toolNames),
  }, { codeGeneration: { strings: false, wasm: false } })
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

async function execute(message) {
  const sandbox = createSandbox(message.toolNames)
  const script = new vm.Script('(async () => {\n' + message.code + '\n})()', {
    filename: 'tidecode-code-mode.js',
  })
  const output = await script.runInContext(sandbox, { timeout: message.limits.timeoutMs })
  await Promise.all(Array.from(pendingToolPromises))
  return assertCloneable(await resolveReturnedValue(output))
}

parentPort.on('message', (message) => {
  if (message.type === 'tool_result') {
    const pending = pendingToolCalls.get(message.callId)
    if (!pending) return
    pendingToolCalls.delete(message.callId)
    if (message.error) pending.reject(new Error(message.error))
    else pending.resolve(message.result)
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
  try {
    return JSON.parse(JSON.stringify(value, (_key, nestedValue: unknown) => {
      if (typeof nestedValue === 'bigint') return `${nestedValue}n`
      if (nestedValue instanceof Uint8Array) return Array.from(nestedValue)
      return nestedValue
    }))
  } catch {
    return String(value)
  }
}

function serializeToolResult(result: AgentToolExecutionResult): unknown {
  const safeResult = toJsonSafe(result) as Record<string, unknown>
  const {
    displayBody: _displayBody,
    modelOutput: _modelOutput,
    resultPresentation: _resultPresentation,
    truncated: _truncated,
    ...modelResult
  } = safeResult
  return {
    ...modelResult,
  }
}

function capDisplayBody(result: AgentToolExecutionResult) {
  return result.displayBody ?? result.body
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function capExecutionOutput(output: unknown, maxBytes: number) {
  const safeOutput = toJsonSafe(output)
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
  private readonly preloadedToolNames: readonly string[]

  public constructor(private readonly registry: AgentToolRegistry, preloadedToolNames?: readonly string[]) {
    this.preloadedToolNames = preloadedToolNames ?? registry.entries
      .filter((entry) => !isDynamicAgentTool(entry))
      .map((entry) => entry.name)
  }

  public async run(
    code: string,
    options: {
      abortSignal?: AbortSignal
      allowedToolNames?: readonly string[]
      limits?: Partial<CodeModeExecutionLimits>
    } = {},
  ): Promise<CodeModeExecutionResult> {
    const limits = { ...DEFAULT_CODE_MODE_EXECUTION_LIMITS, ...options.limits }
    const executionId = randomUUID()
    let executableCode = code
    let validationError = validateCodeModeProgram(executableCode, limits.maxCodeBytes)
    if (validationError?.includes('invalid JavaScript') === true) {
      const repairedCode = repairCodeModePatchProgram(code) ?? repairCodeModeProgramSyntax(code)
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

    const toolNames = Array.from(new Set([
      ...this.preloadedToolNames,
      ...(options.allowedToolNames ?? []),
    ]))
    const unavailableToolName = toolNames.find((name) => !this.registry.get(name))
    if (unavailableToolName) {
      return errorResult(executionId, `Tool "${unavailableToolName}" is not available in the Code Mode registry.`)
    }

    const worker = new Worker(CODE_MODE_WORKER_SOURCE, { eval: true })
    this.activeWorkers.add(worker)
    const toolCalls: CodeModeToolCallRecord[] = []
    let settled = false
    let timeoutId: NodeJS.Timeout | undefined
    let abortHandler: (() => void) | undefined

    const settle = async (): Promise<void> => {
      if (settled) return
      settled = true
      if (timeoutId) clearTimeout(timeoutId)
      if (abortHandler && options.abortSignal) options.abortSignal.removeEventListener('abort', abortHandler)
      this.activeWorkers.delete(worker)
      await worker.terminate()
    }

    return await new Promise<CodeModeExecutionResult>((resolve) => {
      const finish = (result: CodeModeExecutionResult) => {
        void settle().then(() => resolve(result))
      }

      timeoutId = setTimeout(() => finish(errorResult(executionId, `Code Mode execution exceeded the ${limits.timeoutMs}ms timeout.`, toolCalls)), limits.timeoutMs)
      abortHandler = () => finish(errorResult(executionId, 'Code Mode execution was aborted.', toolCalls, 'aborted'))
      options.abortSignal?.addEventListener('abort', abortHandler, { once: true })

      worker.on('message', (message: CodeModeWorkerResultMessage | CodeModeWorkerErrorMessage | CodeModeWorkerToolCallMessage) => {
        if (settled) return
        if (message.type === 'result') {
          const output = capExecutionOutput(message.output, limits.maxOutputBytes)
          const failedToolCalls = toolCalls.filter((toolCall) => toolCall.status === 'error')
          if (failedToolCalls.length > 0) {
            const failureCount = failedToolCalls.length
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

          finish({
            executionId,
            output: output.output,
            outputTruncated: output.outputTruncated,
            status: 'success',
            summary: `Code Mode completed with ${toolCalls.length} tool call${toolCalls.length === 1 ? '' : 's'}.`,
            toolCalls,
            truncated: output.outputTruncated,
          })
          return
        }

        if (message.type === 'error') {
          finish(errorResult(executionId, `Code Mode failed: ${message.error}`, toolCalls))
          return
        }

        if (message.type !== 'tool_call') return
        if (toolCalls.length >= limits.maxToolCalls) {
          const response: CodeModeWorkerToolResultMessage = {
            callId: message.callId,
            error: `Code Mode exceeded the ${limits.maxToolCalls}-tool-call limit.`,
            type: 'tool_result',
          }
          worker.postMessage(response)
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

        const toolStartedAt = Date.now()
        void entry.execute(message.arguments, {
          abortSignal: options.abortSignal,
          toolCallId: `${executionId}-${message.callId}`,
        }).then((result) => {
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
            status: result.status,
            ...(result.subject
              ? { subject: asRecord(toJsonSafe(result.subject)) as CodeModeToolCallRecord['subject'] }
              : {}),
            summary: result.summary,
          })
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
          worker.postMessage({
            callId: message.callId,
            error: error instanceof Error ? error.message : String(error),
            type: 'tool_result',
          } satisfies CodeModeWorkerToolResultMessage)
        })
      })
      worker.on('error', (error) => finish(errorResult(executionId, `Code Mode worker failed: ${error.message}`, toolCalls)))
      worker.on('exit', (exitCode) => {
        if (!settled && exitCode !== 0) finish(errorResult(executionId, `Code Mode worker exited with code ${exitCode}.`, toolCalls))
      })
      worker.postMessage({
        code: executableCode,
        limits,
        toolNames,
        type: 'execute',
      })
    })
  }

  public async dispose() {
    await Promise.all(Array.from(this.activeWorkers, (worker) => worker.terminate()))
    this.activeWorkers.clear()
  }
}
