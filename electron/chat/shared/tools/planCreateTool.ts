import { jsonSchema, tool } from 'ai'
import { createPlan } from '../../../plans/service'
import type { WorkspaceToolContext } from './workspaceToolPaths'
import { createPlanToolResult } from './planToolResult'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'
import { captureCheckpointFileStateIfNeeded } from './workspaceToolResults'

export function createPlanCreateTool(context: WorkspaceToolContext) {
  return tool({
    description: 'Create an implementation plan in .tidecode/plans/.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        content: {
          description: 'Complete implementation plan in Markdown.',
          type: 'string',
        },
        title: {
          description: 'Optional plan title used when the Markdown has no heading.',
          type: 'string',
        },
      },
      required: ['content'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      try {
        const input = rawInput as { content?: unknown; title?: unknown }
        if (typeof input.content !== 'string') {
          throw new Error('plan_create requires Markdown "content".')
        }
        if (input.title !== undefined && typeof input.title !== 'string') {
          throw new Error('plan_create "title" must be a string when provided.')
        }

        return createPlanToolResult(
          await createPlan({
            beforeMutation: (absolutePath) => captureCheckpointFileStateIfNeeded(context.checkpointId, absolutePath),
            content: input.content,
            ...(typeof input.title === 'string' ? { title: input.title } : {}),
            workspaceRootPath: context.workspaceRootPath,
          }),
        )
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Plan creation failed.'))
      }
    },
  })
}
