import { jsonSchema, tool } from 'ai'
import { classifyWorkspaceMemoryPath, MEMORY_INDEX_PATH } from '../../../memory/service'
import {
  createReadToolResult,
  resolveReadOnlyTargetPath,
  ROOT_CAPABLE_WORKSPACE_PATH_DESCRIPTION,
  WorkspaceTargetNotFoundError,
  type WorkspaceToolContext,
} from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'
import { createSuccessResult } from './workspaceToolResults'

function createMissingWorkspaceMemoryReadResult(
  workspaceRootPath: string,
  error: WorkspaceTargetNotFoundError,
) {
  const memoryPath = classifyWorkspaceMemoryPath(error.absolutePath, workspaceRootPath)
  if (!memoryPath) return null

  if (memoryPath.kind === 'index') {
    return createSuccessResult({
      body: 'No workspace memory yet.',
      semantics: { memory_state: 'empty', path: memoryPath.path },
      subject: { kind: 'file', path: memoryPath.path },
      summary: 'No workspace memory yet.',
    })
  }

  if (memoryPath.kind === 'entry') {
    return createSuccessResult({
      body: `Workspace memory entry does not exist: ${memoryPath.path}. Read ${MEMORY_INDEX_PATH} for available entries.`,
      semantics: { memory_state: 'missing_entry', path: memoryPath.path },
      subject: { kind: 'file', path: memoryPath.path },
      summary: `Workspace memory entry does not exist: ${memoryPath.path}`,
    })
  }

  return createSuccessResult({
    body: `Invalid workspace memory path: ${memoryPath.path}. Read ${MEMORY_INDEX_PATH} or a Markdown entry under .tidecode/memory/folders/.../.`,
    semantics: { memory_state: 'invalid_path', path: memoryPath.path },
    subject: { kind: 'file', path: memoryPath.path },
    summary: `Invalid workspace memory path: ${memoryPath.path}`,
  })
}

export function createReadTool(context: WorkspaceToolContext) {
  return tool({
    description: 'Read exactly one existing text file, image, or directory; an empty string or "." refers to the bound workspace root. Text reads return up to 500 lines within a safe model-output byte budget and provide next_offset when more content remains.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        path: {
          description: ROOT_CAPABLE_WORKSPACE_PATH_DESCRIPTION,
          type: 'string',
        },
        limit: { description: 'Optional requested number of lines. Values above 500 are capped at 500.', minimum: 1, type: 'number' },
        offset: { description: 'Starting line number (1-based index). Defaults to 1.', minimum: 1, type: 'number' },
      },
      required: ['path'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      const input = rawInput as { limit?: number; offset?: number; path?: string }
      try {
        if (typeof input.path !== 'string') {
          throw new Error('File path ("path") is required.')
        }
        const targetPath = input.path === '' ? '.' : input.path
        const target = await resolveReadOnlyTargetPath(
          context.workspaceRootPath,
          targetPath,
          context.terminalExecutionMode,
        )
        return await createReadToolResult(target.absolutePath, target.displayPath, input.offset, input.limit)
      } catch (error) {
        if (error instanceof WorkspaceTargetNotFoundError) {
          const memoryResult = createMissingWorkspaceMemoryReadResult(context.workspaceRootPath, error)
          if (memoryResult) return memoryResult
        }
        return createToolErrorResult(getToolErrorSummary(error, 'Read failed.'))
      }
    },
  })
}
