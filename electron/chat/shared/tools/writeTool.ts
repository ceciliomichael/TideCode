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
    description: [
      'Write a complete file using structured content. Use this tool to create files or intentionally replace an entire file.',
      'Write human-readable source by default: preserve the repository\'s existing formatting conventions and never minify, compress, or line-pack code merely to reduce tool-call size or token usage unless the user explicitly requests minified output.',
      'Keep logical structure visually clear using normal indentation, line breaks, spacing, and grouping appropriate to the file type and surrounding source.',
    ].join(' '),
    inputSchema: jsonSchema({
      additionalProperties: true,
      properties: {
        content: {
          description: 'Complete file contents. Keep human-authored source conventionally formatted and readable; do not pseudo-minify or collapse unrelated code onto long lines unless explicitly requested.',
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
