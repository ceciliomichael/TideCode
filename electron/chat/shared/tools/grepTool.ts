import { jsonSchema, tool } from 'ai'
import { createGrepToolResult, resolveReadOnlyTargetPath, type WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createGrepTool(context: WorkspaceToolContext) {
  return tool({
    description: 'Search file contents.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        path: {
          description: 'File or directory path. Omit for the workspace root.',
          type: 'string',
        },
        include: { type: 'string' },
        pattern: { minLength: 1, type: 'string' },
      },
      required: ['pattern'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      const input = rawInput as { include?: string; path?: string; pattern: string }
      try {
        const target = await resolveReadOnlyTargetPath(
          context.workspaceRootPath,
          input.path,
          context.terminalExecutionMode,
        )
        return await createGrepToolResult(
          context.workspaceRootPath,
          target.absolutePath,
          target.displayPath,
          input.pattern,
          input.include,
        )
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Search failed.'))
      }
    },
  })
}
