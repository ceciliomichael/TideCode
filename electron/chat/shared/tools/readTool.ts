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
    description: 'Read exactly one existing text file or image (maximum 500 lines at a time; specify offset and limit for line ranges).',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        path: {
          description: WORKSPACE_PATH_DESCRIPTION,
          type: 'string',
        },
        limit: { description: 'Maximum number of lines to read (maximum 500 lines at a time). Defaults to 500.', maximum: 500, minimum: 1, type: 'number' },
        offset: { description: 'Starting line number (1-based index). Defaults to 1.', minimum: 1, type: 'number' },
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
        context.readScopes?.delete(target.absolutePath)
        const result = await createReadToolResult(target.absolutePath, target.displayPath, input.offset, input.limit)
        const semantics = result.semantics
        const startLine = semantics?.start_line
        const endLine = semantics?.end_line
        if (
          result.status === 'success' &&
          semantics?.is_directory !== true &&
          typeof startLine === 'number' &&
          Number.isInteger(startLine) &&
          startLine >= 1 &&
          typeof endLine === 'number' &&
          Number.isInteger(endLine) &&
          endLine >= startLine
        ) {
          context.readScopes?.set(target.absolutePath, { endLine, startLine })
        }
        return result
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Read failed.'))
      }
    },
  })
}
