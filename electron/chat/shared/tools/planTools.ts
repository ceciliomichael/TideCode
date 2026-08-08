import type { ToolSet } from 'ai'
import type { WorkspaceToolContext } from './workspaceToolPaths'
import { createPlanCreateTool } from './planCreateTool'
import { createPlanEditTool } from './planEditTool'

export function createPlanToolSet(context: WorkspaceToolContext): ToolSet {
  return {
    plan_create: createPlanCreateTool(context),
    plan_edit: createPlanEditTool(context),
  }
}
