import {
  assertWorkspaceDirectory,
  normalizeWorkspacePath,
} from '../../../workspace/paths'
import type { AgentToolContext } from '../toolTypes'
import type { SkillSummary } from '../../../../src/types/skills'
import type { WorkspaceToolContext } from './workspaceToolPaths'

export async function createToolContext(
  input: AgentToolContext,
  enabledSkills: readonly SkillSummary[] = [],
): Promise<WorkspaceToolContext> {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  await assertWorkspaceDirectory(workspaceRootPath)
  return {
    checkpointId: input.checkpointId?.trim() || null,
    conversationId: input.conversationId?.trim() || null,
    enabledSkills,
    terminalExecutionMode: input.terminalExecutionMode ?? 'sandbox',
    workspaceRootPath,
  }
}
