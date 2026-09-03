import type { ToolSet } from 'ai'
import type { WorkspaceToolContext } from './workspaceToolPaths'
import { createPlanCreateTool } from './planCreateTool'
import { createPlanEditTool } from './planEditTool'
import type { PlanRuntimeState } from './planRuntimeState'

export function createPlanToolSet(context: WorkspaceToolContext, runtimeState: PlanRuntimeState): ToolSet {
  return {
    plan_create: createPlanCreateTool(context, runtimeState),
    plan_edit: createPlanEditTool(context, runtimeState),
  }
}
