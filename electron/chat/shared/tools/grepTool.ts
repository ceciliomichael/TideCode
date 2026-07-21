import { jsonSchema, tool } from 'ai'
import { createGrepToolResult, resolveReadableTargetPath, type WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createGrepTool(context: WorkspaceToolContext, isPlanMode: boolean) {
  const editingGuidance = isPlanMode ? '' : ' After reading the target file, use `apply_patch` for small edits.'
  const description =
    context.terminalExecutionMode === 'full'
      ? `Search file contents in visible workspace files for regex or string matches. Use include to filter filenames, then read the matching files with \`read\`. Treat grep results as hints, not full context.${editingGuidance}`
      : `Search file contents in visible workspace files for regex or string matches. In Sandbox mode, absolute_path restricts the search to a file or directory inside the workspace. Use include to filter filenames, then read the matching files with \`read\`. Treat grep results as hints, not full context.${editingGuidance}`

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
