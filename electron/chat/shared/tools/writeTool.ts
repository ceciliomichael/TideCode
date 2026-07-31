import { jsonSchema, tool } from 'ai'
import { createWholeFileWriteToolResult, type WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createWriteTool(context: WorkspaceToolContext) {
  return tool({
    description: 'Writes content to a file.',
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
