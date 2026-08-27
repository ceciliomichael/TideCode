import type { AgentToolExecutionResult } from '../toolTypes'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export type WorkspaceMutationErrorCode =
  | 'FILE_NOT_FOUND'
  | 'INVALID_ARGUMENT'
  | 'OVERLAPPING_EDITS'
  | 'REVISION_CONFLICT'
  | 'TARGET_AMBIGUOUS'
  | 'TARGET_NOT_FOUND'
  | 'WRITE_FAILED'

export type WorkspaceMutationStage =
  | 'FILESYSTEM_WRITE'
  | 'INPUT_VALIDATION'
  | 'POST_WRITE_VERIFY'
  | 'REVISION_CHECK'
  | 'TARGET_MATCH'

export class WorkspaceMutationError extends Error {
  public constructor(
    public readonly code: WorkspaceMutationErrorCode,
    public readonly stage: WorkspaceMutationStage,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'WorkspaceMutationError'
  }
}

export function createWorkspaceMutationErrorResult(
  error: unknown,
  fallback: string,
): AgentToolExecutionResult {
  const summary = getToolErrorSummary(error, fallback)
  if (!(error instanceof WorkspaceMutationError)) return createToolErrorResult(summary)

  return createToolErrorResult(summary, undefined, {
    error_code: error.code,
    stage: error.stage,
    ...(error.code === 'TARGET_AMBIGUOUS' || error.code === 'TARGET_NOT_FOUND'
      ? { recoverable: true }
      : {}),
    ...(error.details ?? {}),
  })
}
