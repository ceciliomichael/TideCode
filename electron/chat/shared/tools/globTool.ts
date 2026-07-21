import { jsonSchema, tool } from 'ai'
import { createGlobToolResult, resolveReadableTargetPath, type WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createGlobTool(context: WorkspaceToolContext) {
  const description =
    context.terminalExecutionMode === 'full'
      ? 'Returns up to 100 visible absolute file paths matching the glob pattern below absolute_path, or the workspace root when omitted.'
      : 'Returns up to 100 visible absolute file paths matching the glob pattern below a workspace directory. absolute_path defaults to the workspace root and must remain inside it.'

  return tool({
    description,
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        absolute_path: { type: 'string' },
        pattern: { minLength: 1, type: 'string' },
      },
      required: ['pattern'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      const input = rawInput as { absolute_path?: string; pattern: string }
      try {
        const target = resolveReadableTargetPath(
          context.workspaceRootPath,
          input.absolute_path,
          context.terminalExecutionMode,
        )
        return await createGlobToolResult(
          context.workspaceRootPath,
          target.absolutePath,
          target.displayPath,
          input.pattern,
        )
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Glob failed.'))
      }
    },
  })
}
