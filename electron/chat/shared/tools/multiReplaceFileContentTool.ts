import { jsonSchema, tool } from 'ai'
import type { AgentToolExecutionResult } from '../toolTypes'
import { createMultiReplaceFileContentToolResult, type ReplaceFileContentChunk, type WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

const MULTI_REPLACE_FILE_CONTENT_DESCRIPTION = 'Applies multiple non-contiguous exact-string replacements to a single existing file in one atomic operation.'

interface ChunkInput {
  targetContent: string
  replacementContent: string
  startLine: number
  endLine: number
  allowMultiple: boolean
}

export function createMultiReplaceFileContentTool(context: WorkspaceToolContext) {
  return tool({
    description: MULTI_REPLACE_FILE_CONTENT_DESCRIPTION,
    inputSchema: jsonSchema<{
      absolute_path: string
      chunks: ChunkInput[]
    }>({
      additionalProperties: false,
      properties: {
        absolute_path: {
          description: 'Absolute path to the file to edit.',
          type: 'string',
        },
        chunks: {
          description: 'Ordered list of replacement operations to apply. Each must target a distinct non-overlapping region.',
          items: {
            additionalProperties: false,
            properties: {
              allowMultiple: {
                description:
                  'When true, all occurrences of targetContent within the line range are replaced. When false, more than one occurrence causes a validation error.',
                type: 'boolean',
              },
              endLine: {
                description: 'Ending line of the search window (1-indexed, inclusive).',
                minimum: 1,
                type: 'integer',
              },
              replacementContent: {
                description: 'The text to insert in place of targetContent.',
                type: 'string',
              },
              startLine: {
                description: 'Starting line of the search window (1-indexed, inclusive).',
                minimum: 1,
                type: 'integer',
              },
              targetContent: {
                description: 'The exact string to replace, including all whitespace and indentation.',
                minLength: 1,
                type: 'string',
              },
            },
            required: ['targetContent', 'replacementContent', 'startLine', 'endLine', 'allowMultiple'],
            type: 'object',
          },
          minItems: 1,
          type: 'array',
        },
      },
      required: ['absolute_path', 'chunks'],
      type: 'object',
    }),
    execute: async (rawInput): Promise<AgentToolExecutionResult> => {
      const input = rawInput as { absolute_path: string; chunks: ChunkInput[] }
      const chunks: ReplaceFileContentChunk[] = input.chunks.map((c) => ({
        allowMultiple: c.allowMultiple,
        endLine: c.endLine,
        replacementContent: c.replacementContent,
        startLine: c.startLine,
        targetContent: c.targetContent,
      }))
      try {
        return await createMultiReplaceFileContentToolResult(context, {
          absolute_path: input.absolute_path,
          chunks,
        })
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Multi-file replacement failed.'))
      }
    },
  })
}
