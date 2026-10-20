import { Buffer } from 'node:buffer'
import type { AgentToolRegistry } from '../../tools/registry'
import { CodeModeRuntimeError, formatDiagnostic, toDiagnostic, type CodeModeDiagnostic } from '../diagnostics'
import { ToolRuntime } from '../toolRuntime'
import {
  DEFAULT_CODE_MODE_EXECUTION_LIMITS,
  type CodeModeExecutionLimits,
  type CodeModeExecutionResult,
  type CodeModeToolCallRecord,
} from '../types'
import { runCodeModeProcess } from './process'

interface ExecuteCodeModeOptions {
  obtainedTools?: Set<string>
  discoveredMcpTools?: Set<string>
  abortSignal?: AbortSignal
  allowedToolNames?: readonly string[]
  executionId: string
  limits?: Partial<CodeModeExecutionLimits>
  payloads?: Readonly<Record<string, string>>
  registry: AgentToolRegistry
  source: string
  workspaceRootPath: string
}

function validateInput(options: ExecuteCodeModeOptions, limits: CodeModeExecutionLimits) {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
      throw new CodeModeRuntimeError('InvalidToolArguments', `Code Mode limit ${name} must be a positive bounded integer.`)
    }
  }
  if (limits.memoryLimitMb < 8) {
    throw new CodeModeRuntimeError('InvalidToolArguments', 'Code Mode memoryLimitMb must be at least 8.')
  }
  if (Buffer.byteLength(options.source, 'utf8') > limits.maxCodeBytes) {
    throw new CodeModeRuntimeError('ParseError', `Code Mode source exceeded the ${limits.maxCodeBytes}-byte limit.`)
  }
  const payloads = options.payloads ?? {}
  const entries = Object.entries(payloads)
  if (entries.length > 64) {
    throw new CodeModeRuntimeError('InvalidToolArguments', 'Code Mode payloads exceeded the 64-item limit.')
  }
  let bytes = 0
  for (const [key, value] of entries) {
    if (!key.trim() || Buffer.byteLength(key, 'utf8') > 128 || ['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw new CodeModeRuntimeError('InvalidToolArguments', `Invalid Code Mode payload key: ${key}.`)
    }
    if (typeof value !== 'string') {
      throw new CodeModeRuntimeError('InvalidToolArguments', `Code Mode payload '${key}' must be a string.`)
    }
    bytes += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8')
  }
  if (bytes > limits.maxPayloadBytes) {
    throw new CodeModeRuntimeError('InvalidToolArguments', `Code Mode payloads exceeded the ${limits.maxPayloadBytes}-byte limit.`)
  }
}

export async function executeCodeMode(options: ExecuteCodeModeOptions): Promise<CodeModeExecutionResult> {
  const limits = { ...DEFAULT_CODE_MODE_EXECUTION_LIMITS, ...options.limits }
  const toolCalls: CodeModeToolCallRecord[] = []
  const failure = (diagnostic: CodeModeDiagnostic): CodeModeExecutionResult => ({
    diagnostic,
    engine: 'v8',
    error: formatDiagnostic(diagnostic),
    executionId: options.executionId,
    status: diagnostic.kind === 'Cancelled' ? 'aborted' : 'error',
    summary: formatDiagnostic(diagnostic),
    toolCalls: [...toolCalls],
    truncated: false,
  })
  try {
    validateInput(options, limits)
  } catch (error) {
    return failure(toDiagnostic(error))
  }

  const controller = new AbortController()
  const abort = () => controller.abort()
  options.abortSignal?.addEventListener('abort', abort, { once: true })
  if (options.abortSignal?.aborted) {
    abort()
  }
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, limits.timeoutMs)
  try {
    const runtime = new ToolRuntime(options.registry, {
      obtainedTools: options.obtainedTools ?? new Set(),
      discoveredMcpTools: options.discoveredMcpTools ?? new Set(),
      abortSignal: controller.signal,
      allowedToolNames: options.allowedToolNames,
      executionId: options.executionId,
      limits,
      toolCalls,
      workspaceRootPath: options.workspaceRootPath,
    })
    const missing = runtime.unavailableAllowedTool()
    if (missing) {
      throw new CodeModeRuntimeError('UnknownTool', `Code Mode allowed tool '${missing}' is unavailable in this registry.`)
    }
    const result = await runCodeModeProcess({
      source: options.source,
      payloads: options.payloads ?? {},
      limits,
      runtime,
      abortSignal: controller.signal,
    })
    await runtime.drain()
    if (timedOut) {
      throw new CodeModeRuntimeError('TimeoutExceeded', `Code Mode exceeded the ${limits.timeoutMs}ms timeout.`)
    }
    if (controller.signal.aborted) {
      throw new CodeModeRuntimeError('Cancelled', 'Code Mode execution was aborted.')
    }
    const failed = toolCalls.filter((call) => call.status === 'error').length
    return {
      engine: 'v8',
      executionId: options.executionId,
      output: result.output,
      outputTruncated: result.outputTruncated,
      status: 'success',
      summary: failed > 0
        ? `Code Mode completed after handling ${failed} failed tool call${failed === 1 ? '' : 's'}.`
        : `Code Mode completed with ${toolCalls.length} tool call${toolCalls.length === 1 ? '' : 's'}.`,
      toolCalls: [...toolCalls],
      truncated: result.outputTruncated ?? false,
    }
  } catch (error) {
    controller.abort()
    let diagnostic = toDiagnostic(error)
    if (timedOut) {
      diagnostic = { kind: 'TimeoutExceeded', message: `Code Mode exceeded the ${limits.timeoutMs}ms timeout.` }
    } else if (options.abortSignal?.aborted) {
      diagnostic = { kind: 'Cancelled', message: 'Code Mode execution was aborted.' }
    }
    if (diagnostic.kind === 'ToolContractRequired') {
      return {
        engine: 'v8',
        executionId: options.executionId,
        output: diagnostic.message,
        status: 'success',
        summary: 'Retrieved tools',
        toolCalls: [...toolCalls],
        truncated: false,
      }
    }
    return failure(diagnostic)
  } finally {
    clearTimeout(timer)
    options.abortSignal?.removeEventListener('abort', abort)
    controller.abort()
  }
}
