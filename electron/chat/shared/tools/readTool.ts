import { jsonSchema, tool } from 'ai'
import { createReadToolResult, resolveReadableTargetPath, type WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createReadTool(context: WorkspaceToolContext) {
  const description =
    context.terminalExecutionMode === 'full'
      ? 'Returns numbered UTF-8 file lines or sorted directory entries. offset is 1-based, limit defaults to 2000, file output is capped at 256 KB, and binary files return an error.'
      : 'Returns numbered UTF-8 file lines or sorted directory entries inside the workspace. absolute_path must remain inside the workspace; offset is 1-based, limit defaults to 2000, file output is capped at 256 KB, and binary files return an error.'

  return tool({
    description,
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
        const target = resolveReadableTargetPath(
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
