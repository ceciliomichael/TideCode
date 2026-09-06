import type { ToolInvocationResultPresentation } from '../../../../src/types/chat'
import type { AgentToolResultSubject } from '../toolTypes'

export interface CodeModeExecutionLimits {
  maxCallDepth: number
  maxCodeBytes: number
  maxConcurrentToolCalls: number
  maxOutputBytes: number
  maxSteps: number
  maxToolCalls: number
  timeoutMs: number
}

export const DEFAULT_CODE_MODE_EXECUTION_LIMITS: CodeModeExecutionLimits = {
  maxCallDepth: 100,
  maxCodeBytes: 100_000,
  maxConcurrentToolCalls: 8,
  maxOutputBytes: 1_000_000,
  maxSteps: 100_000,
  maxToolCalls: 100,
  timeoutMs: 300_000,
}

export interface CodeModeToolCallRecord {
  arguments: unknown
  body?: string
  durationMs: number
  name: string
  resultPresentation?: ToolInvocationResultPresentation
  semantics?: Record<string, unknown>
  status: 'error' | 'success'
  subject?: AgentToolResultSubject
  summary: string
}

export interface CodeModeExecutionResult {
  diagnostic?: {
    kind: string
    location?: { line: number; column: number }
    message: string
    suggestions?: string[]
  }
  engine?: 'v2'
  executionId: string
  error?: string
  output?: unknown
  outputTruncated?: boolean
  steps?: number
  summary: string
  toolCalls: CodeModeToolCallRecord[]
  status: 'aborted' | 'error' | 'success'
  truncated: boolean
}

export interface CodeModeWorkerExecuteMessage {
  executionMode: 'full' | 'sandbox'
  limits: CodeModeExecutionLimits
  moduleSource?: string
  source: string
  toolNames: string[]
  type: 'execute'
  workspaceRootPath: string
}

export interface CodeModeWorkerModuleResolveMessage {
  requestId: string
  specifier: string
  type: 'module_resolve'
}

export interface CodeModeWorkerModuleResolveResultMessage {
  error?: string
  requestId: string
  resolved?: string
  type: 'module_resolve_result'
}

export interface CodeModeWorkerToolCallMessage {
  arguments: unknown
  callId: string
  logicalCallCount?: number
  name: string
  type: 'tool_call'
}

export interface CodeModeWorkerToolResultMessage {
  callId: string
  error?: string
  errorResult?: unknown
  result?: unknown
  type: 'tool_result'
}

export interface CodeModeWorkerResultMessage {
  output?: unknown
  type: 'result'
}

export interface CodeModeWorkerErrorMessage {
  error: string
  type: 'error'
}
