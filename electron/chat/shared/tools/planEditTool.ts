import { jsonSchema, tool } from 'ai'
import { editPlan } from '../../../plans/service'
import { normalizePlanRelativePath } from '../../../../src/lib/planContracts'
import type { WorkspaceToolContext } from './workspaceToolPaths'
import { createPlanToolResult } from './planToolResult'
import type { PlanRuntimeState } from './planRuntimeState'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'
import { captureCheckpointFileStateIfNeeded } from './workspaceToolResults'

export function createPlanEditTool(context: WorkspaceToolContext, runtimeState: PlanRuntimeState) {
  return tool({
    description: 'Replace the active persisted Tidecode plan with revised Markdown. Use only when an active plan already exists and needs revision.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        content: {
          description: 'Complete revised Markdown content for the active plan.',
          type: 'string',
        },
        path: {
          description: 'Exact active plan path, such as .tidecode/plans/plan-001.md.',
          type: 'string',
        },
        title: {
          description: 'Optional replacement plan title.',
          type: 'string',
        },
      },
      required: ['path', 'content'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      const activePlanPath = runtimeState.activePlanPath
      if (!activePlanPath) {
        return createToolErrorResult('plan_edit requires an active Tidecode plan. Create one with plan_create first.')
      }

      try {
        const input = rawInput as { content?: unknown; path?: unknown; title?: unknown }
        if (typeof input.path !== 'string') {
          throw new Error('plan_edit requires the active plan "path".')
        }
        if (typeof input.content !== 'string') {
          throw new Error('plan_edit requires complete revised Markdown "content".')
        }
        if (input.title !== undefined && typeof input.title !== 'string') {
          throw new Error('plan_edit "title" must be a string when provided.')
        }

        const normalizedActivePath = normalizePlanRelativePath(activePlanPath)
        const normalizedRequestedPath = normalizePlanRelativePath(input.path)
        if (normalizedRequestedPath !== normalizedActivePath) {
          throw new Error('plan_edit may only revise the active plan: ' + normalizedActivePath)
        }

        const artifact = await editPlan({
          beforeMutation: (absolutePath) => captureCheckpointFileStateIfNeeded(context.checkpointId, absolutePath),
          content: input.content,
          relativePath: normalizedActivePath,
          ...(typeof input.title === 'string' ? { title: input.title } : {}),
          workspaceRootPath: context.workspaceRootPath,
        })
        return createPlanToolResult(artifact)
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Plan edit failed.'))
      }
    },
  })
}
