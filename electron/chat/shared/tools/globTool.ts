import { jsonSchema, tool } from 'ai'
import { createGlobToolResult, resolveReadableTargetPath, type WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createGlobTool(context: WorkspaceToolContext) {
  const description =
    context.terminalExecutionMode === 'full'
      ? 'Find file paths matching a glob pattern. Read the matched files with `read` before editing.'
      : 'Find file paths matching a glob pattern inside the workspace. In Sandbox mode, absolute_path limits the search scope to a directory inside the workspace. Read the matched files with `read` before editing.'

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
