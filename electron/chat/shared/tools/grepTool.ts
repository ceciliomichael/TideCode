import { jsonSchema, tool } from 'ai'
import { createGrepToolResult, resolveReadableTargetPath, type WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createGrepTool(context: WorkspaceToolContext) {
  const description =
    context.terminalExecutionMode === 'full'
      ? 'Returns visible workspace text matches for the ripgrep regex pattern, sorted by path and line number. absolute_path may select one file or directory; include is an optional filename glob.'
      : 'Returns visible workspace text matches for the ripgrep regex pattern, sorted by path and line number. absolute_path may select one workspace file or directory; include is an optional filename glob.'

  return tool({
    description,
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        absolute_path: { type: 'string' },
        include: { type: 'string' },
        pattern: { minLength: 1, type: 'string' },
      },
      required: ['pattern'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      const input = rawInput as { absolute_path?: string; include?: string; pattern: string }
      try {
        const target = resolveReadableTargetPath(
          context.workspaceRootPath,
          input.absolute_path,
          context.terminalExecutionMode,
        )
        return await createGrepToolResult(
          context.workspaceRootPath,
          target.absolutePath,
          target.displayPath,
          input.pattern,
          input.include,
        )
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Search failed.'))
      }
    },
  })
}
