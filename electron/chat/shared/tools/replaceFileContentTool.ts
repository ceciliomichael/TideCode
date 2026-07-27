import { jsonSchema, tool } from 'ai'
import type { AgentToolExecutionResult } from '../toolTypes'
import { createReplaceFileContentToolResult, type WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

const REPLACE_FILE_CONTENT_DESCRIPTION =
  'Replaces a single exact contiguous block of text inside an existing file. Supports relative or absolute file paths. Note: If making multiple edits to the same file or function, make a single comprehensive replacement covering the entire region, or re-read the file between tool calls, as previous edits alter line numbers and target text.'

export function createReplaceFileContentTool(context: WorkspaceToolContext) {
  return tool({
    description: REPLACE_FILE_CONTENT_DESCRIPTION,
    inputSchema: jsonSchema<{
      path?: string
      absolute_path?: string
      targetContent: string
      replacementContent: string
      startLine: number
      endLine: number
      allowMultiple?: boolean
    }>({
      additionalProperties: false,
      properties: {
        path: {
          description: 'Relative or absolute path to the file to edit.',
          type: 'string',
        },
        absolute_path: {
          description: 'Alias for path (relative or absolute path to the file to edit).',
          type: 'string',
        },
        allowMultiple: {
          description:
            'When true, all occurrences of targetContent within the line range are replaced. Defaults to false, which rejects multiple matches.',
          type: 'boolean',
        },
        endLine: {
          description:
            'Last line where the target was read (1-indexed, inclusive). If the exact target moved and is unique, the tool can still find it.',
          minimum: 1,
          type: 'integer',
        },
        replacementContent: {
          description: 'The text to insert in place of targetContent.',
          type: 'string',
        },
        startLine: {
          description:
            'First line where the target was read (1-indexed, inclusive).',
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
      required: ['path', 'targetContent', 'replacementContent', 'startLine', 'endLine'],
      type: 'object',
    }),
    execute: async (rawInput): Promise<AgentToolExecutionResult> => {
      const input = rawInput as {
        path?: string
        absolute_path?: string
        targetContent: string
        replacementContent: string
        startLine: number
        endLine: number
        allowMultiple?: boolean
      }
      const targetPath = input.path ?? input.absolute_path
      if (!targetPath) {
        throw new Error('File path ("path") is required.')
      }
      try {
        return await createReplaceFileContentToolResult(context, {
          ...input,
          path: targetPath,
          allowMultiple: input.allowMultiple ?? false,
        })
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'File replacement failed.'))
      }
    },
  })
}
