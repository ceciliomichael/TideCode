import { jsonSchema, tool } from 'ai'
import {
  createListToolResult,
  resolveReadOnlyTargetPath,
  WORKSPACE_PATH_DESCRIPTION,
  type WorkspaceToolContext,
} from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createListTool(context: WorkspaceToolContext) {
  return tool({
    description: 'List exactly one existing directory; omit path for the workspace root and use read for files.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        path: {
          description: `${WORKSPACE_PATH_DESCRIPTION} Omit for the workspace root.`,
          type: 'string',
        },
      },
      type: 'object',
    }),
    execute: async (rawInput) => {
      const input = rawInput as { path?: string }
      try {
        const target = await resolveReadOnlyTargetPath(
          context.workspaceRootPath,
          input.path,
          context.terminalExecutionMode,
        )
        return await createListToolResult(context.workspaceRootPath, target.absolutePath, target.displayPath)
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'List failed.'))
      }
    },
  })
}
