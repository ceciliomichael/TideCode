import type { AgentToolExecutionResult } from '../toolTypes'
import type { CodeModeToolCallRecord } from './types'

export function getCodeModeToolCallStatus(
  result: AgentToolExecutionResult,
): CodeModeToolCallRecord['status'] {
  if (result.status === 'error') {
    return 'error'
  }

  return result.semantics?.status === 'failed' ? 'error' : 'success'
}
