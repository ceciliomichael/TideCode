import { jsonSchema, tool } from 'ai'
import type { AgentToolExecutionResult } from '../toolTypes'
import { createEditToolResult, type WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

const REPLACE_FILE_CONTENT_DESCRIPTION =
  'Replaces a block of text in a file. Leading indentation differences are ignored, but the remaining text must match exactly.'

export function createEditTool(context: WorkspaceToolContext) {
  return tool({
    description: REPLACE_FILE_CONTENT_DESCRIPTION,
    inputSchema: jsonSchema<{
      path: string
      targetContent: string
      replacementContent: string
      startLine: number
      endLine: number
      allowMultiple?: boolean
    }>({
      additionalProperties: false,
      properties: {
        path: {
          description: 'Path to the file to edit.',
          type: 'string',
        },
        allowMultiple: {
          description: 'Whether to replace all occurrences within the line range.',
          type: 'boolean',
        },
        endLine: {
          description: 'Ending line number (1-indexed).',
          minimum: 1,
          type: 'integer',
        },
        replacementContent: {
          description: 'Replacement text.',
          type: 'string',
        },
        startLine: {
          description: 'Starting line number (1-indexed).',
          minimum: 1,
          type: 'integer',
        },
        targetContent: {
          description: 'Text to replace. Leading spaces or tabs on each line may differ from the file.',
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
        targetContent: string
        replacementContent: string
        startLine: number
        endLine: number
        allowMultiple?: boolean
      }
      const targetPath = input.path
      if (!targetPath) {
        throw new Error('File path ("path") is required.')
      }
      try {
        return await createEditToolResult(context, {
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
