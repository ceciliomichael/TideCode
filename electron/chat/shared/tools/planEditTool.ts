import { jsonSchema, tool } from 'ai'
import { editPlan } from '../../../plans/service'
import type { WorkspaceToolContext } from './workspaceToolPaths'
import { createPlanToolResult } from './planToolResult'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'
import { captureCheckpointFileStateIfNeeded } from './workspaceToolResults'

export function createPlanEditTool(context: WorkspaceToolContext) {
  return tool({
    description:
      'Replace the entire Markdown document of an existing .tidecode/plans/ plan. This is a full-document replacement, not a partial patch.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        content: {
          description:
            'Complete revised self-contained Markdown document. Send the entire plan, including unchanged sections; do not send only a diff or fragment.',
          type: 'string',
        },
        path: {
          description: 'Existing plan path, such as .tidecode/plans/plan-001.md.',
          type: 'string',
        },
        title: {
          description: 'Optional explicit H1 title. When provided, it replaces the document title or adds one if missing.',
          type: 'string',
        },
      },
      required: ['path', 'content'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      try {
        const input = rawInput as { content?: unknown; path?: unknown; title?: unknown }
        if (typeof input.path !== 'string' || input.path.trim().length === 0) {
          throw new Error('plan_edit requires an existing plan "path".')
        }
        if (typeof input.content !== 'string') {
          throw new Error('plan_edit requires Markdown "content".')
        }
        if (input.title !== undefined && typeof input.title !== 'string') {
          throw new Error('plan_edit "title" must be a string when provided.')
        }

        return createPlanToolResult(
          await editPlan({
            beforeMutation: (absolutePath) => captureCheckpointFileStateIfNeeded(context.checkpointId, absolutePath),
            content: input.content,
            relativePath: input.path,
            ...(typeof input.title === 'string' ? { title: input.title } : {}),
            workspaceRootPath: context.workspaceRootPath,
          }),
        )
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Plan update failed.'))
      }
    },
  })
}
