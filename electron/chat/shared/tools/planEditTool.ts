import { jsonSchema, tool } from 'ai'
import { editPlan } from '../../../plans/service'
import type { WorkspaceToolContext } from './workspaceToolPaths'
import { createPlanToolResult } from './planToolResult'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'
import { captureCheckpointFileStateIfNeeded } from './workspaceToolResults'

export function createPlanEditTool(context: WorkspaceToolContext) {
  return tool({
    description: 'Replace the complete Markdown content of an existing .tidecode/plans/ plan.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        content: {
          description: 'Complete revised implementation plan in Markdown.',
          type: 'string',
        },
        path: {
          description: 'Existing plan path returned by plan_create, such as .tidecode/plans/plan-001.md.',
          type: 'string',
        },
      },
      required: ['path', 'content'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      try {
        const input = rawInput as { content?: unknown; path?: unknown }
        if (typeof input.path !== 'string' || input.path.trim().length === 0) {
          throw new Error('plan_edit requires an existing plan "path".')
        }
        if (typeof input.content !== 'string') {
          throw new Error('plan_edit requires Markdown "content".')
        }

        return createPlanToolResult(
          await editPlan({
            beforeMutation: (absolutePath) => captureCheckpointFileStateIfNeeded(context.checkpointId, absolutePath),
            content: input.content,
            relativePath: input.path,
            workspaceRootPath: context.workspaceRootPath,
          }),
        )
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Plan update failed.'))
      }
    },
  })
}
