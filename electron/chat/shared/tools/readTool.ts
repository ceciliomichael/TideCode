import { jsonSchema, tool } from 'ai'
import { createReadToolResult, resolveReadOnlyTargetPath, type WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createReadTool(context: WorkspaceToolContext) {
  return tool({
    description: 'Returns numbered UTF-8 file lines or sorted directory entries within the active execution context. offset is 1-based, limit defaults to 2000, file output is capped at 256 KB, and binary files return an error.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        absolute_path: { type: 'string' },
        limit: { minimum: 1, type: 'number' },
        offset: { minimum: 1, type: 'number' },
      },
      required: ['absolute_path'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      const input = rawInput as { absolute_path: string; limit?: number; offset?: number }
      try {
        const target = await resolveReadOnlyTargetPath(
          context.workspaceRootPath,
          input.absolute_path,
          context.terminalExecutionMode,
        )
        return await createReadToolResult(target.absolutePath, target.displayPath, input.offset, input.limit)
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Read failed.'))
      }
    },
  })
}
