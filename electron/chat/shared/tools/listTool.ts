import { jsonSchema, tool } from 'ai'
import { classifyWorkspaceMemoryPath, MEMORY_DETAILS_DIRECTORY, MEMORY_DIRECTORY } from '../../../memory/service'
import {
  createListToolResult,
  OPTIONAL_ROOT_CAPABLE_WORKSPACE_PATH_DESCRIPTION,
  resolveReadOnlyTargetPath,
  type WorkspaceToolContext,
} from './workspaceTools'
import { resolveReadableTargetPath } from './workspaceToolPaths'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'
import { createSuccessResult } from './workspaceToolResults'
import { WorkspaceTargetNotFoundError } from './workspaceTools'

function emptyMemoryListing(absolutePath: string, workspaceRootPath: string) {
  const memoryPath = classifyWorkspaceMemoryPath(absolutePath, workspaceRootPath)
  const message = memoryPath?.path === MEMORY_DIRECTORY
    ? 'No workspace memory yet.'
    : memoryPath?.path === MEMORY_DETAILS_DIRECTORY
      ? 'No memory details yet.'
      : null
  if (!message) return null
  return createSuccessResult({
    body: message,
    semantics: { memory_state: 'empty', has_more: false, returned_count: 0, total_count: 0 },
    subject: { kind: 'directory', path: memoryPath?.path },
    summary: message,
  })
}

export function createListTool(context: WorkspaceToolContext) {
  return tool({
    description: 'List exactly one existing directory; an omitted path, empty string, or "." refers to the bound workspace root. Use read for files.',
    inputSchema: jsonSchema({
      additionalProperties: true,
      properties: {
        path: {
          description: OPTIONAL_ROOT_CAPABLE_WORKSPACE_PATH_DESCRIPTION,
          type: 'string',
        },
        limit: { description: 'Maximum entries to return (1-500). Defaults to 100.', maximum: 500, minimum: 1, type: 'integer' },
        offset: { description: 'Number of sorted entries to skip. Defaults to 0.', minimum: 0, type: 'integer' },
      },
      type: 'object',
    }),
    execute: async (rawInput) => {
      const input = rawInput as { limit?: number; offset?: number; path?: string }
      try {
        const target = await resolveReadOnlyTargetPath(
          context.workspaceRootPath,
          input.path,
          context.terminalExecutionMode,
          {
            conversationId: context.conversationId,
            enabledSkills: context.enabledSkills,
          },
        )
        const result = await createListToolResult(context.workspaceRootPath, target.absolutePath, target.displayPath, input.offset, input.limit)
        return result.semantics?.total_count === 0
          ? emptyMemoryListing(target.absolutePath, context.workspaceRootPath) ?? result
          : result
      } catch (error) {
        if (error instanceof WorkspaceTargetNotFoundError) {
          const target = resolveReadableTargetPath(
            context.workspaceRootPath,
            input.path,
            context.terminalExecutionMode,
            { allowGlobalAgentsDirectory: true, conversationId: context.conversationId, enabledSkills: context.enabledSkills },
          )
          const empty = emptyMemoryListing(target.absolutePath, context.workspaceRootPath)
          if (empty) return empty
        }
        return createToolErrorResult(getToolErrorSummary(error, 'List failed.'))
      }
    },
  })
}
