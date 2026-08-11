import { jsonSchema, tool } from 'ai'
import {
  createReadToolResult,
  resolveReadOnlyTargetPath,
  WORKSPACE_PATH_DESCRIPTION,
  type WorkspaceToolContext,
} from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createReadTool(context: WorkspaceToolContext) {
  return tool({
    description: 'Read a text file, image, or directory.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        path: {
          description: WORKSPACE_PATH_DESCRIPTION,
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
