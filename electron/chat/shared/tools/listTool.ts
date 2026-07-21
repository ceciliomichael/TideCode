import { jsonSchema, tool } from 'ai'
import { createListToolResult, resolveReadableTargetPath, type WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createListTool(context: WorkspaceToolContext) {
  const description =
    context.terminalExecutionMode === 'full'
      ? 'Returns up to 100 sorted, visible direct child entries of absolute_path, or the workspace root when omitted. Directory names end with /.'
      : 'Returns up to 100 sorted, visible direct child entries of a workspace directory. absolute_path defaults to the workspace root and must remain inside it. Directory names end with /.'

  return tool({
    description,
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        absolute_path: { type: 'string' },
      },
      type: 'object',
    }),
    execute: async (rawInput) => {
      const input = rawInput as { absolute_path?: string }
      try {
        const target = resolveReadableTargetPath(
          context.workspaceRootPath,
          input.absolute_path,
          context.terminalExecutionMode,
        )
        return await createListToolResult(context.workspaceRootPath, target.absolutePath, target.displayPath)
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'List failed.'))
      }
    },
  })
}
