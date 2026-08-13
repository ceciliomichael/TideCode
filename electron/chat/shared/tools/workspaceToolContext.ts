import {
  assertWorkspaceDirectory,
  normalizeWorkspacePath,
} from '../../../workspace/paths'
import type { AgentToolContext } from '../toolTypes'
import type { WorkspaceToolContext } from './workspaceToolPaths'

export async function createToolContext(input: AgentToolContext): Promise<WorkspaceToolContext> {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  await assertWorkspaceDirectory(workspaceRootPath)
  return {
    checkpointId: input.checkpointId?.trim() || null,
    terminalExecutionMode: input.terminalExecutionMode ?? 'sandbox',
    workspaceRootPath,
  }
}
