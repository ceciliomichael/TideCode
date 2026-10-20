import type { ToolInvocationResultPresentation } from '../../../../src/types/chat'
import type { AgentToolResultSubject } from '../toolTypes'

export interface CodeModeExecutionLimits {
  maxCodeBytes: number
  maxConcurrentToolCalls: number
  maxOutputBytes: number
  maxPayloadBytes: number
  maxToolCalls: number
  memoryLimitMb: number
  timeoutMs: number
}

export const DEFAULT_CODE_MODE_EXECUTION_LIMITS: CodeModeExecutionLimits = {
  maxCodeBytes: 100_000,
  maxConcurrentToolCalls: 8,
  maxOutputBytes: 1_000_000,
  maxPayloadBytes: 2_000_000,
  maxToolCalls: 100,
  memoryLimitMb: 128,
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
  engine?: 'v8'
  executionId: string
  error?: string
  output?: unknown
  outputTruncated?: boolean
  summary: string
  toolCalls: CodeModeToolCallRecord[]
  status: 'aborted' | 'error' | 'success'
  truncated: boolean
}
