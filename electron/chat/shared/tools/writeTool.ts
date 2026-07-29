import { jsonSchema, tool } from 'ai'
import { createWholeFileWriteToolResult, type WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createWriteTool(context: WorkspaceToolContext) {
  return tool({
    description: 'Writes content as the complete UTF-8 contents of absolute_path within the active execution context, creates parent directories, normalizes line endings to LF, and returns an error when the content is unchanged.',
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
