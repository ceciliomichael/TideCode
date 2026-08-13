import { jsonSchema, tool } from 'ai'
import {
  createGlobToolResult,
  resolveReadOnlyTargetPath,
  WORKSPACE_PATH_DESCRIPTION,
  type WorkspaceToolContext,
} from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createGlobTool(context: WorkspaceToolContext) {
  return tool({
    description: 'Find files by pattern under exactly one directory; use the exact path returned by list or the user.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        path: {
          description: `${WORKSPACE_PATH_DESCRIPTION} Omit for the workspace root.`,
          type: 'string',
        },
        pattern: { minLength: 1, type: 'string' },
        limit: { description: 'Maximum matches to return (1-500). Defaults to 100.', maximum: 500, minimum: 1, type: 'integer' },
        offset: { description: 'Number of sorted matches to skip. Defaults to 0.', minimum: 0, type: 'integer' },
      },
      required: ['pattern'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      const input = rawInput as { limit?: number; offset?: number; path?: string; pattern: string }
      try {
        const target = await resolveReadOnlyTargetPath(
          context.workspaceRootPath,
          input.path,
          context.terminalExecutionMode,
        )
        return await createGlobToolResult(
          context.workspaceRootPath,
          target.absolutePath,
          target.displayPath,
          input.pattern,
          input.offset,
          input.limit,
        )
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Glob failed.'))
      }
    },
  })
}
