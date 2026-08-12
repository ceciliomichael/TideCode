import type { AgentToolExecutionResult } from '../toolTypes'

export function createToolErrorResult(summary: string, body?: string): AgentToolExecutionResult {
  const message = body ?? summary
  return {
    body: message,
    displayBody: message,
    status: 'error',
    summary,
  }
}

export function getToolErrorSummary(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback
}
