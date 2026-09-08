import { Buffer } from 'node:buffer'
import type { AgentToolRegistry } from '../../tools/registry'
import {
  DEFAULT_CODE_MODE_EXECUTION_LIMITS,
  type CodeModeExecutionLimits,
  type CodeModeExecutionResult,
  type CodeModeToolCallRecord,
} from '../types'
import { CodeModeInterpreter, parseCodeModeProgram } from './interpreter'
import { CodeModeRuntimeError, formatDiagnostic, toDiagnostic } from './model'
import { ToolRuntime } from './toolRuntime'

export interface ExecuteCodeModeV2Options {
  abortSignal?: AbortSignal
  allowedToolNames?: readonly string[]
  executionId: string
  limits?: Partial<CodeModeExecutionLimits>
  payloads?: Readonly<Record<string, string>>
  registry: AgentToolRegistry
  source: string
  workspaceRootPath: string
}

function capOutput(output: unknown, maxBytes: number): { output: unknown; outputTruncated: boolean } {
  if (output === undefined) return { output: undefined, outputTruncated: false }
  const serialized = JSON.stringify(output)
  if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) return { output, outputTruncated: false }
  return {
    output: {
      message: `Code Mode output exceeded the ${maxBytes}-byte limit. Return a smaller summary from the program.`,
    },
    outputTruncated: true,
  }
}

export async function executeCodeModeV2(options: ExecuteCodeModeV2Options): Promise<CodeModeExecutionResult> {
  const limits = { ...DEFAULT_CODE_MODE_EXECUTION_LIMITS, ...options.limits }
  const toolCalls: CodeModeToolCallRecord[] = []
  if (Buffer.byteLength(options.source, 'utf8') > limits.maxCodeBytes) {
    const diagnostic = {
      kind: 'ParseError',
      message: `Code Mode source exceeded the ${limits.maxCodeBytes}-byte limit.`,
    }
    return {
      diagnostic,
      engine: 'v2',
      error: `${diagnostic.kind}: ${diagnostic.message}`,
      executionId: options.executionId,
      status: 'error',
      summary: `${diagnostic.kind}: ${diagnostic.message}`,
      toolCalls,
      truncated: false,
    }
  }

  const payloads = options.payloads ?? {}
  const payloadEntries = Object.entries(payloads)
  if (payloadEntries.length > 64) {
    const diagnostic = { kind: 'InvalidToolArguments', message: 'Code Mode payloads exceeded the 64-item limit.' }
    return { diagnostic, engine: 'v2', error: `${diagnostic.kind}: ${diagnostic.message}`, executionId: options.executionId, status: 'error', summary: `${diagnostic.kind}: ${diagnostic.message}`, toolCalls, truncated: false }
  }
  let payloadBytes = 0
  for (const [key, value] of payloadEntries) {
    if (key.trim().length === 0) {
      const diagnostic = { kind: 'InvalidToolArguments', message: 'Code Mode payload keys must be non-empty.' }
      return { diagnostic, engine: 'v2', error: `${diagnostic.kind}: ${diagnostic.message}`, executionId: options.executionId, status: 'error', summary: `${diagnostic.kind}: ${diagnostic.message}`, toolCalls, truncated: false }
    }
    if (Buffer.byteLength(key, 'utf8') > 128) {
      const diagnostic = { kind: 'InvalidToolArguments', message: `Code Mode payload key '${key}' exceeded the 128-byte limit.` }
      return { diagnostic, engine: 'v2', error: `${diagnostic.kind}: ${diagnostic.message}`, executionId: options.executionId, status: 'error', summary: `${diagnostic.kind}: ${diagnostic.message}`, toolCalls, truncated: false }
    }
    if (['__proto__', 'prototype', 'constructor'].includes(key)) {
      const diagnostic = { kind: 'InvalidToolArguments', message: `Code Mode payload key '${key}' is reserved.` }
      return { diagnostic, engine: 'v2', error: `${diagnostic.kind}: ${diagnostic.message}`, executionId: options.executionId, status: 'error', summary: `${diagnostic.kind}: ${diagnostic.message}`, toolCalls, truncated: false }
    }
    if (typeof value !== 'string') {
      const diagnostic = { kind: 'InvalidToolArguments', message: `Code Mode payload '${key}' must be a string.` }
      return { diagnostic, engine: 'v2', error: `${diagnostic.kind}: ${diagnostic.message}`, executionId: options.executionId, status: 'error', summary: `${diagnostic.kind}: ${diagnostic.message}`, toolCalls, truncated: false }
    }
    payloadBytes += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8')
    if (payloadBytes > limits.maxPayloadBytes) {
      const diagnostic = { kind: 'InvalidToolArguments', message: `Code Mode payloads exceeded the ${limits.maxPayloadBytes}-byte limit.` }
      return { diagnostic, engine: 'v2', error: `${diagnostic.kind}: ${diagnostic.message}`, executionId: options.executionId, status: 'error', summary: `${diagnostic.kind}: ${diagnostic.message}`, toolCalls, truncated: false }
    }
  }

  let program
  try {
    program = parseCodeModeProgram(options.source)
  } catch (error) {
    const diagnostic = toDiagnostic(error)
    return {
      diagnostic,
      engine: 'v2',
      error: formatDiagnostic(diagnostic),
      executionId: options.executionId,
      status: 'error',
      summary: formatDiagnostic(diagnostic),
      toolCalls,
      truncated: false,
    }
  }

  const executionController = new AbortController()
  let timedOut = false
  let parentAbortHandler: (() => void) | undefined
  if (options.abortSignal) {
    parentAbortHandler = () => executionController.abort(options.abortSignal?.reason)
    options.abortSignal.addEventListener('abort', parentAbortHandler, { once: true })
    if (options.abortSignal.aborted) parentAbortHandler()
  }
  const deadline = Date.now() + limits.timeoutMs
  const timeoutId = setTimeout(() => {
    timedOut = true
    executionController.abort(new Error('Code Mode execution timed out.'))
  }, limits.timeoutMs)

  const toolRuntime = new ToolRuntime(options.registry, {
    abortSignal: executionController.signal,
    allowedToolNames: options.allowedToolNames,
    executionId: options.executionId,
    limits,
    toolCalls,
    workspaceRootPath: options.workspaceRootPath,
  })
  const unavailableAllowedTool = toolRuntime.unavailableAllowedTool()
  if (unavailableAllowedTool) {
    const diagnostic = {
      kind: 'UnknownTool',
      message: `Code Mode allowed tool '${unavailableAllowedTool}' is unavailable in this registry.`,
    }
    clearTimeout(timeoutId)
    if (parentAbortHandler && options.abortSignal) options.abortSignal.removeEventListener('abort', parentAbortHandler)
    return {
      diagnostic,
      engine: 'v2',
      error: `${diagnostic.kind}: ${diagnostic.message}`,
      executionId: options.executionId,
      status: 'error',
      summary: `${diagnostic.kind}: ${diagnostic.message}`,
      toolCalls,
      truncated: false,
    }
  }
  const interpreter = new CodeModeInterpreter(toolRuntime, payloads, limits, executionController.signal, deadline)
  let steps = 0
  try {
    const result = await interpreter.execute(program)
    steps = result.steps
    await toolRuntime.drain()
    if (timedOut) {
      throw new CodeModeRuntimeError('TimeoutExceeded', `Code Mode exceeded the ${limits.timeoutMs}ms timeout.`)
    }
    if (options.abortSignal?.aborted) {
      throw new CodeModeRuntimeError('Cancelled', 'Code Mode execution was aborted.')
    }
    const bounded = capOutput(result.value, limits.maxOutputBytes)
    const handledFailureCount = toolCalls.filter((call) => call.status === 'error').length
    return {
      engine: 'v2',
      executionId: options.executionId,
      output: bounded.output,
      outputTruncated: bounded.outputTruncated,
      status: 'success',
      steps,
      summary: handledFailureCount > 0
        ? `Code Mode V2 completed after handling ${handledFailureCount} failed tool call${handledFailureCount === 1 ? '' : 's'}.`
        : `Code Mode V2 completed with ${toolCalls.length} tool call${toolCalls.length === 1 ? '' : 's'}.`,
      toolCalls,
      truncated: bounded.outputTruncated,
    }
  } catch (error) {
    await toolRuntime.drain()
    let normalizedError = error
    if (timedOut) {
      normalizedError = new CodeModeRuntimeError(
        'TimeoutExceeded',
        `Code Mode exceeded the ${limits.timeoutMs}ms timeout.`,
      )
    } else if (options.abortSignal?.aborted) {
      normalizedError = new CodeModeRuntimeError('Cancelled', 'Code Mode execution was aborted.')
    }
    const diagnostic = toDiagnostic(normalizedError)
    return {
      diagnostic,
      engine: 'v2',
      error: formatDiagnostic(diagnostic),
      executionId: options.executionId,
      status: diagnostic.kind === 'Cancelled' ? 'aborted' : 'error',
      steps,
      summary: formatDiagnostic(diagnostic),
      toolCalls,
      truncated: false,
    }
  } finally {
    clearTimeout(timeoutId)
    if (parentAbortHandler && options.abortSignal) options.abortSignal.removeEventListener('abort', parentAbortHandler)
    if (!executionController.signal.aborted) executionController.abort()
  }
}
