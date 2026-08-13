import type { ToolInvocationResultPresentation } from '../../../../src/types/chat'
import type { AgentToolResultSubject } from '../toolTypes'

export interface CodeModeExecutionLimits {
  maxCodeBytes: number
  maxOutputBytes: number
  maxToolCalls: number
  timeoutMs: number
}

export const DEFAULT_CODE_MODE_EXECUTION_LIMITS: CodeModeExecutionLimits = {
  maxCodeBytes: 100_000,
  maxOutputBytes: 1_000_000,
  maxToolCalls: 100,
  timeoutMs: 30_000,
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
  executionId: string
  error?: string
  output?: unknown
  outputTruncated?: boolean
  summary: string
  toolCalls: CodeModeToolCallRecord[]
  status: 'aborted' | 'error' | 'success'
  truncated: boolean
}

export interface CodeModeWorkerExecuteMessage {
  code: string
  limits: CodeModeExecutionLimits
  toolNames: string[]
  type: 'execute'
}

export interface CodeModeWorkerToolCallMessage {
  arguments: unknown
  callId: string
  name: string
  type: 'tool_call'
}

export interface CodeModeWorkerToolResultMessage {
  callId: string
  error?: string
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
