import { jsonSchema, tool } from 'ai'
import {
  createWholeFileWriteToolResult,
  WORKSPACE_PATH_DESCRIPTION,
  type WorkspaceToolContext,
} from './workspaceTools'
import {
  createWorkspaceMutationErrorResult,
  WorkspaceMutationError,
} from './workspaceMutationErrors'

export function createWriteTool(context: WorkspaceToolContext) {
  return tool({
description: 'Write a complete file using structured content. Use this tool to create files or intentionally replace an entire file.',
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
      try {
        const input = rawInput as { content?: unknown; path?: unknown }
        if (typeof input.path !== 'string' || input.path.trim().length === 0) {
          throw new WorkspaceMutationError('INVALID_ARGUMENT', 'INPUT_VALIDATION', 'File path ("path") is required.')
        }
        if (typeof input.content !== 'string') {
          throw new WorkspaceMutationError('INVALID_ARGUMENT', 'INPUT_VALIDATION', 'Write requires complete string content.')
        }

        return await createWholeFileWriteToolResult(context, {
          content: input.content,
          path: input.path,
        })
      } catch (error) {
        return createWorkspaceMutationErrorResult(error, 'File change failed.')
      }
    },
  })
}
