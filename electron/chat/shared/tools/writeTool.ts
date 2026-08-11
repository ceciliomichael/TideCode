import { jsonSchema, tool } from 'ai'
import {
  createWholeFileWriteToolResult,
  WORKSPACE_PATH_DESCRIPTION,
  type WorkspaceToolContext,
} from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createWriteTool(context: WorkspaceToolContext) {
  return tool({
    description: 'Write a complete file.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        content: { description: 'Complete file contents.', type: 'string' },
        path: {
          description: `${WORKSPACE_PATH_DESCRIPTION} Use the JSON key \`path\`, not \`file\`.`,
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
