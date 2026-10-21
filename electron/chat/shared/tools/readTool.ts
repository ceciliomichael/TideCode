import { jsonSchema, tool } from 'ai'
import { captureCheckpointFileStateIfNeeded } from './workspaceToolResults'
import { resolveReadableTargetPath } from './workspaceToolPaths'
import { readLatestConversationMemory } from '../../history/eventStore'
import { CHAT_DURABLE_MEMORY_PATH } from '../compaction/durableMemory'
import { classifyWorkspaceMemoryPath, MEMORY_INDEX_PATH, migrateLegacyWorkspaceMemory, refreshWorkspaceMemoryIndex } from '../../../memory/service'
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
    body: `Invalid workspace memory path: ${memoryPath.path}. Read ${MEMORY_INDEX_PATH} or a Markdown entry under .tidecode/memory/details/.../.`,
    semantics: { memory_state: 'invalid_path', path: memoryPath.path },
    subject: { kind: 'file', path: memoryPath.path },
    summary: `Invalid workspace memory path: ${memoryPath.path}`,
  })
}

export function createReadTool(context: WorkspaceToolContext) {
  return tool({
    description: 'Read one existing text file, image, or the active chat\'s durable memory at @chat/DURABLE.md. Use tools.list to inspect workspace directories. Text reads stay within safe model-output budgets.',
    inputSchema: jsonSchema({
      additionalProperties: true,
      properties: {
        path: {
          description: ROOT_CAPABLE_WORKSPACE_PATH_DESCRIPTION,
          type: 'string',
        },
        limit: { description: 'Optional requested number of lines. Values above 500 are capped at 500.', minimum: 1, type: 'number' },
        offset: { description: 'Starting line number (1-based index). Defaults to 1.', minimum: 1, type: 'number' },
        cursor: { description: 'Opaque continuation cursor from a previous read next_cursor. Pass it back exactly; do not construct or modify it.', type: 'string' },
      },
      required: ['path'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      const input = rawInput as { cursor?: string; limit?: number; offset?: number; path?: string }
      try {
        if (typeof input.path !== 'string') {
          throw new Error('File path ("path") is required.')
        }
        let targetPath = input.path === '' ? '.' : input.path
        if (targetPath === CHAT_DURABLE_MEMORY_PATH) {
          if (!context.conversationId) {
            throw new Error('Chat durable memory requires an active conversation.')
          }
          const memory = await readLatestConversationMemory(context.conversationId)
          if (!memory) {
            return createSuccessResult({
              body: 'This chat has no saved durable memory yet.',
              semantics: { memory_state: 'empty' },
              subject: { kind: 'file', path: CHAT_DURABLE_MEMORY_PATH },
              summary: 'No chat durable memory yet.',
            })
          }
          return createSuccessResult({
            body: memory.markdown,
            semantics: { memory_state: 'available', source_digest: memory.sourceDigest },
            subject: { kind: 'file', path: CHAT_DURABLE_MEMORY_PATH },
            summary: 'Read active chat durable memory.',
          })
        }
        const normalizedTargetPath = targetPath.replace(/\\/gu, '/')
        if (normalizedTargetPath.includes('.tidecode/memory/folders/')) {
          await migrateLegacyWorkspaceMemory(context.workspaceRootPath)
          targetPath = normalizedTargetPath.replace('.tidecode/memory/folders/', '.tidecode/memory/details/')
        }
        const candidate = resolveReadableTargetPath(context.workspaceRootPath, targetPath, context.terminalExecutionMode, {
          allowGlobalAgentsDirectory: true,
          conversationId: context.conversationId,
          enabledSkills: context.enabledSkills,
        })
        if (classifyWorkspaceMemoryPath(candidate.absolutePath, context.workspaceRootPath)?.kind === 'index') {
          await refreshWorkspaceMemoryIndex(context.workspaceRootPath, (absolutePath) => (
            captureCheckpointFileStateIfNeeded(context.checkpointId, absolutePath)
          ))
        }
        const target = await resolveReadOnlyTargetPath(
          context.workspaceRootPath,
          targetPath,
          context.terminalExecutionMode,
          {
            conversationId: context.conversationId,
            enabledSkills: context.enabledSkills,
          },
        )
        const result = await createReadToolResult(
          target.absolutePath,
          target.displayPath,
          input.offset,
          input.limit,
          false,
          input.cursor,
        )
        if (result.modelOutput && context.captureModelOutput) {
          context.captureModelOutput(result.modelOutput)
          return {
            ...result,
            modelOutput: undefined,
          }
        }
        return result
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
