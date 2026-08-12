import { jsonSchema, tool } from 'ai'
import { readPersistedToolOutput } from './toolOutputStore'
import { createErrorResult, createSuccessResult } from './workspaceToolResults'
import { getToolErrorSummary } from './toolResult'

interface ReadToolOutputInput {
  limit?: number
  offset?: number
  output_id: string
}

export function createReadToolOutputTool() {
  return tool({
    description:
      'Read a bounded section of a previously truncated tool result. Use the output_id supplied by the tool result and request only the lines needed.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        limit: {
          default: 200,
          description: 'Maximum number of lines to return. Defaults to 200 and never exceeds 2000.',
          maximum: 2_000,
          minimum: 1,
          type: 'integer',
        },
        offset: {
          default: 1,
          description: '1-indexed line number to start reading from.',
          minimum: 1,
          type: 'integer',
        },
        output_id: {
          description: 'The output_id from the truncated tool result.',
          minLength: 1,
          type: 'string',
        },
      },
      required: ['output_id'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      const input = rawInput as ReadToolOutputInput
      try {
        const result = await readPersistedToolOutput({
          limit: input.limit,
          offset: input.offset,
          outputId: input.output_id,
        })
        return createSuccessResult({
          body: result.body,
          semantics: {
            line_count: result.lineCount,
            next_offset: result.nextOffset,
            offset: input.offset ?? 1,
            output_id: result.outputId,
          },
          subject: {
            kind: 'tool_output',
            path: result.outputId,
          },
          summary: `Read tool output ${result.outputId}`,
        })
      } catch (error) {
        return createErrorResult(getToolErrorSummary(error, 'Unable to read the saved tool output.'))
      }
    },
  })
}
