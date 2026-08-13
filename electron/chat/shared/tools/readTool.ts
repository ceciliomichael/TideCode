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
    description: 'Read exactly one existing text file or image. By default, returns up to 500 lines. Set full_file: true to read the complete text file; full_file takes precedence over offset and limit.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        path: {
          description: WORKSPACE_PATH_DESCRIPTION,
          type: 'string',
        },
        full_file: { description: 'Read the complete text file. When true, this takes precedence over offset and limit.', type: 'boolean' },
        limit: { description: 'Optional number of lines to read, up to 500. Omit for the default 500-line window.', maximum: 500, minimum: 1, type: 'number' },
        offset: { description: 'Starting line number (1-based index). Defaults to 1.', minimum: 1, type: 'number' },
      },
      required: ['path'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      const input = rawInput as { full_file?: boolean; limit?: number; offset?: number; path?: string }
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
        const result = await createReadToolResult(target.absolutePath, target.displayPath, input.offset, input.limit, input.full_file === true)
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
