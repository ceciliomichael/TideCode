import { jsonSchema, tool } from 'ai'
import { createReadToolResult, resolveReadableTargetPath, type WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createReadTool(context: WorkspaceToolContext, isPlanMode: boolean) {
  const editingGuidance = isPlanMode
    ? ''
    : ' The latest read is the source of truth for edits. After reading, use `apply_patch` for small edits or `write` for a full replacement.'
  const description =
    context.terminalExecutionMode === 'full'
      ? `Read a UTF-8 text file as numbered lines. Do not guess paths. Use limit and offset for pagination, and read enough contiguous context in one call to avoid repeated reads; 500-line reads are acceptable when the file is large.${editingGuidance}`
      : `Read a UTF-8 text file inside the workspace as numbered lines. In Sandbox mode, absolute_path must point to a file inside the workspace. Do not guess paths. Use limit and offset for pagination, and read enough contiguous context in one call to avoid repeated reads; 500-line reads are acceptable when the file is large.${editingGuidance}`

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
