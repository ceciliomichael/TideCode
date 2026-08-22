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
description: 'Write a complete file using structured content. Use this tool to create files or intentionally replace an entire file. Pass expectedRevision from the latest read when replacing an existing file when available.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        content: { description: 'Complete file contents.', type: 'string' },
        expectedRevision: {
          description: 'Optional sha256 revision returned by the latest read. The write fails if the existing file changed since that read.',
          minLength: 1,
          type: 'string',
        },
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
        const input = rawInput as { content?: unknown; expectedRevision?: unknown; path?: unknown }
        if (typeof input.path !== 'string' || input.path.trim().length === 0) {
          throw new WorkspaceMutationError('INVALID_ARGUMENT', 'INPUT_VALIDATION', 'File path ("path") is required.')
        }
        if (typeof input.content !== 'string') {
          throw new WorkspaceMutationError('INVALID_ARGUMENT', 'INPUT_VALIDATION', 'Write requires complete string content.')
        }
        if (input.expectedRevision !== undefined && (
          typeof input.expectedRevision !== 'string' || input.expectedRevision.trim().length === 0
        )) {
          throw new WorkspaceMutationError('INVALID_ARGUMENT', 'INPUT_VALIDATION', 'expectedRevision must be a non-empty revision string when provided.')
        }
        return await createWholeFileWriteToolResult(context, {
          content: input.content,
          expectedRevision: input.expectedRevision as string | undefined,
          path: input.path,
        })
      } catch (error) {
        return createWorkspaceMutationErrorResult(error, 'File change failed.')
      }
    },
  })
}
