import { jsonSchema, tool } from 'ai'
import { createPlan } from '../../../plans/service'
import type { WorkspaceToolContext } from './workspaceToolPaths'
import { createPlanToolResult } from './planToolResult'
import type { PlanRuntimeState } from './planRuntimeState'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'
import { captureCheckpointFileStateIfNeeded } from './workspaceToolResults'

export function createPlanCreateTool(context: WorkspaceToolContext, runtimeState: PlanRuntimeState) {
  return tool({
    description: 'Create a complete engineering implementation plan in .tidecode/plans/.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        content: {
          description:
            'Complete self-contained Markdown document. Include context, goals/non-goals, requirements, proposed solution, concrete file-level steps, verification, risks, and acceptance criteria when relevant.',
          type: 'string',
        },
        title: {
          description: 'Optional plan title used when the Markdown has no H1 heading.',
          type: 'string',
        },
      },
      required: ['content'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      if (!runtimeState.enabled) {
        return createToolErrorResult('plan_create is available only while Plan Mode is active.')
      }
      if (runtimeState.activePlanPath) {
        return createToolErrorResult('Plan Mode already has an active plan: ' + runtimeState.activePlanPath)
      }
      if (runtimeState.isCreatingPlan) {
        return createToolErrorResult('Plan creation is already in progress for this turn.')
      }

      runtimeState.isCreatingPlan = true
      try {
        const input = rawInput as { content?: unknown; title?: unknown }
        if (typeof input.content !== 'string') {
          throw new Error('plan_create requires Markdown "content".')
        }
        if (input.title !== undefined && typeof input.title !== 'string') {
          throw new Error('plan_create "title" must be a string when provided.')
        }

        const artifact = await createPlan({
          beforeMutation: (absolutePath) => captureCheckpointFileStateIfNeeded(context.checkpointId, absolutePath),
          content: input.content,
          ...(typeof input.title === 'string' ? { title: input.title } : {}),
          workspaceRootPath: context.workspaceRootPath,
        })
        runtimeState.activePlanPath = artifact.relativePath
        return createPlanToolResult(artifact)
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Plan creation failed.'))
      } finally {
        runtimeState.isCreatingPlan = false
      }
    },
  })
}
