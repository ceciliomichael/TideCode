import { jsonSchema, tool } from 'ai'
import { createWholeFileWriteToolResult, type WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createWriteTool(context: WorkspaceToolContext) {
  return tool({
    description: 'Writes content to a file. The content must be complete. Use the required argument name `path`, not `file` or `filename`.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        content: { description: 'Complete file contents to write.', type: 'string' },
        path: {
          description: 'Path to the file to create or replace. Use `path`, not `file` or `filename`.',
          type: 'string',
        },
      },
      required: ['path', 'content'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      const input = rawInput as { content: string; path?: string }
      try {
        const targetPath = input.path
        if (!targetPath) {
          throw new Error('File path ("path") is required.')
        }
        return await createWholeFileWriteToolResult(context, {
          content: input.content,
          path: targetPath,
        })
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'File change failed.'))
      }
    },
  })
}
