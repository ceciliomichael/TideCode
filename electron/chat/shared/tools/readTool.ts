import { jsonSchema, tool } from 'ai'
import { createReadToolResult, resolveReadOnlyTargetPath, type WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createReadTool(context: WorkspaceToolContext) {
  return tool({
    description: 'Reads file contents or directory entries.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        path: {
          description: 'Path to the file or directory to read.',
          type: 'string',
        },
        limit: { minimum: 1, type: 'number' },
        offset: { minimum: 1, type: 'number' },
      },
      required: ['path'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      const input = rawInput as { limit?: number; offset?: number; path?: string }
      try {
        const targetPath = input.path
        if (!targetPath) {
          throw new Error('File path ("path") is required.')
        }
        const target = await resolveReadOnlyTargetPath(
          context.workspaceRootPath,
          targetPath,
          context.terminalExecutionMode,
        )
        return await createReadToolResult(target.absolutePath, target.displayPath, input.offset, input.limit)
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Read failed.'))
      }
    },
  })
}
