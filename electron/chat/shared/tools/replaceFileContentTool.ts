import { jsonSchema, tool } from 'ai'
import type { AgentToolExecutionResult } from '../toolTypes'
import { createReplaceFileContentToolResult, type WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

const REPLACE_FILE_CONTENT_DESCRIPTION = 'Replaces a single, exact, contiguous block of text inside an existing file.'

export function createReplaceFileContentTool(context: WorkspaceToolContext) {
  return tool({
    description: REPLACE_FILE_CONTENT_DESCRIPTION,
    inputSchema: jsonSchema<{
      absolute_path: string
      targetContent: string
      replacementContent: string
      startLine: number
      endLine: number
      allowMultiple: boolean
    }>({
      additionalProperties: false,
      properties: {
        absolute_path: {
          description: 'Absolute path to the file to edit.',
          type: 'string',
        },
        allowMultiple: {
          description:
            'When true, all occurrences of targetContent within the line range are replaced. When false (default), more than one occurrence causes an error.',
          type: 'boolean',
        },
        endLine: {
          description:
            'Ending line of the search window (1-indexed, inclusive). Must be >= startLine and <= the total line count of the file.',
          minimum: 1,
          type: 'integer',
        },
        replacementContent: {
          description: 'The text to insert in place of targetContent.',
          type: 'string',
        },
        startLine: {
          description:
            'Starting line of the search window (1-indexed, inclusive). The targetContent must appear within [startLine, endLine].',
          minimum: 1,
          type: 'integer',
        },
        targetContent: {
          description:
            'The exact string to replace, including all whitespace and indentation. Must be a unique match within the specified line range (unless allowMultiple is true).',
          minLength: 1,
          type: 'string',
        },
      },
      required: ['absolute_path', 'targetContent', 'replacementContent', 'startLine', 'endLine', 'allowMultiple'],
      type: 'object',
    }),
    execute: async (rawInput): Promise<AgentToolExecutionResult> => {
      const input = rawInput as {
        absolute_path: string
        targetContent: string
        replacementContent: string
        startLine: number
        endLine: number
        allowMultiple: boolean
      }
      try {
        return await createReplaceFileContentToolResult(context, input)
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'File replacement failed.'))
      }
    },
  })
}
