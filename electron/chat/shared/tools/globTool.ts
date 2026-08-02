import { jsonSchema, tool } from 'ai'
import { createGlobToolResult, resolveReadOnlyTargetPath, type WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createGlobTool(context: WorkspaceToolContext) {
  return tool({
    description: 'Find files by pattern.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        path: {
          description: 'Directory path. Omit for the workspace root.',
          type: 'string',
        },
        pattern: { minLength: 1, type: 'string' },
      },
      required: ['pattern'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      const input = rawInput as { path?: string; pattern: string }
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
        )
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Glob failed.'))
      }
    },
  })
}
