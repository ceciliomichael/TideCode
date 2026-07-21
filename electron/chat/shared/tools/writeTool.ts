import { jsonSchema, tool } from 'ai'
import { createWholeFileWriteToolResult, type WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createWriteTool(context: WorkspaceToolContext) {
  const description =
    context.terminalExecutionMode === 'full'
      ? 'Create a new file or overwrite the full contents of an existing file. For small edits to an existing file, use `apply_patch` instead. Do not call write when the target already has identical content. Successful text writes use LF line endings.'
      : 'Create a new file or overwrite the full contents of an existing file. In Sandbox mode, absolute_path must be a path inside the workspace. For small edits to an existing file, use `apply_patch` instead. Do not call write when the target already has identical content. Successful text writes use LF line endings.'

  return tool({
    description,
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        absolute_path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['absolute_path', 'content'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      const input = rawInput as { absolute_path: string; content: string }
      try {
        return await createWholeFileWriteToolResult(context, input)
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'File change failed.'))
      }
    },
  })
}
