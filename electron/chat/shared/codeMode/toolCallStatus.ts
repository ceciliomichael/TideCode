import type { AgentToolExecutionResult } from '../toolTypes'
import type { CodeModeToolCallRecord } from './types'

export function getCodeModeToolCallStatus(
  result: AgentToolExecutionResult,
): CodeModeToolCallRecord['status'] {
  return result.status === 'error' ? 'error' : 'success'
}
