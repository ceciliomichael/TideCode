import { jsonSchema, tool } from 'ai'
import { createListToolResult, resolveReadOnlyTargetPath, type WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createListTool(context: WorkspaceToolContext) {
  return tool({
    description: 'List a directory.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        path: {
          description: 'Directory path. Omit for the workspace root.',
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
