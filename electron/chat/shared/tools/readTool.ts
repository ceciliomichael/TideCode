import { jsonSchema, tool } from 'ai'
import { classifyWorkspaceMemoryPath, MEMORY_INDEX_PATH } from '../../../memory/service'
import {
  createReadToolResult,
  resolveReadOnlyTargetPath,
  WorkspaceTargetNotFoundError,
  WORKSPACE_PATH_DESCRIPTION,
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
    description: 'Read exactly one existing text file or image. By default, returns up to 500 lines. Set full_file: true to read the complete text file; full_file takes precedence over offset and limit.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        path: {
          description: WORKSPACE_PATH_DESCRIPTION,
          type: 'string',
        },
        full_file: { description: 'Read the complete text file. When true, this takes precedence over offset and limit.', type: 'boolean' },
        limit: { description: 'Optional number of lines to read, up to 500. Omit for the default 500-line window.', maximum: 500, minimum: 1, type: 'number' },
        offset: { description: 'Starting line number (1-based index). Defaults to 1.', minimum: 1, type: 'number' },
      },
      required: ['path'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      const input = rawInput as { full_file?: boolean; limit?: number; offset?: number; path?: string }
      try {
        const targetPath = input.path
        if (!targetPath) {
          throw new Error('File path ("path") is required.')
        }
        const target = await resolveReadOnlyTargetPath(
          context.workspaceRootPath,
          targetPath,
          context.terminalExecutionMode,
        )
        return await createReadToolResult(target.absolutePath, target.displayPath, input.offset, input.limit, input.full_file === true)
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
