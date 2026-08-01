import {
  assertWorkspaceDirectory,
  normalizeWorkspacePath,
} from '../../../workspace/paths'
import type { AgentToolContext } from '../toolTypes'

export async function createToolContext(input: AgentToolContext) {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  await assertWorkspaceDirectory(workspaceRootPath)
  return {
    checkpointId: input.checkpointId?.trim() || null,
    terminalExecutionMode: input.terminalExecutionMode ?? 'sandbox',
    workspaceRootPath,
  }
}
