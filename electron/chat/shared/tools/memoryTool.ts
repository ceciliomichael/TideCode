import { jsonSchema, tool } from 'ai'
import {
  editMemoryEntry,
  forgetMemoryEntry,
  readMemoryEntry,
  readMemoryIndex,
  writeMemoryEntry,
} from '../../../memory/service'
import { WORKSPACE_PATH_DESCRIPTION, type WorkspaceToolContext } from './workspaceToolPaths'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'
import { captureCheckpointFileStateIfNeeded, createSuccessResult } from './workspaceToolResults'

type MemoryAction = 'edit' | 'forget' | 'read' | 'read_index' | 'write'

interface MemoryToolInput {
  action?: MemoryAction
  content?: string
  new_text?: string
  old_text?: string
  path?: string
  title?: string
}

export function createMemoryTool(context: WorkspaceToolContext) {
  return tool({
    description: 'Read or maintain durable workspace memory under .tidecode/memory/.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        action: {
          description: 'read_index lists memory; read opens one entry; write creates or replaces; edit replaces one exact text block; forget removes.',
          enum: ['read_index', 'read', 'write', 'edit', 'forget'],
          type: 'string',
        },
        content: { description: 'Complete Markdown content for write.', type: 'string' },
        new_text: { description: 'Replacement text for edit; may be empty.', type: 'string' },
        old_text: { description: 'One exact unique text block for edit.', type: 'string' },
        path: {
          description: `${WORKSPACE_PATH_DESCRIPTION} The target must be a memory entry under .tidecode/memory/folders/, ending in .md. Required except for read_index.`,
          type: 'string',
        },
        title: { description: 'Optional H1 title for write when content has no H1.', type: 'string' },
      },
      required: ['action'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      try {
        const input = rawInput as MemoryToolInput
        const action = input.action
        if (!action) {
          throw new Error('memory requires an "action".')
        }

        if (action === 'read_index') {
          const document = await readMemoryIndex(context.workspaceRootPath)
          return createSuccessResult({
            body: document.content,
            semantics: { action, path: document.path },
            subject: { kind: 'memory_index', path: document.path },
            summary: `Read workspace memory index: ${document.path}`,
          })
        }

        if (typeof input.path !== 'string' || input.path.trim().length === 0) {
          throw new Error(`memory ${action} requires "path".`)
        }

        if (action === 'read') {
          const document = await readMemoryEntry({
            path: input.path,
            workspaceRootPath: context.workspaceRootPath,
          })
          return createSuccessResult({
            body: document.content,
            semantics: { action, path: document.path },
            subject: { kind: 'memory', path: document.path },
            summary: `Read workspace memory: ${document.path}`,
          })
        }

        if (action === 'write') {
          if (typeof input.content !== 'string') {
            throw new Error('memory write requires Markdown "content".')
          }
          if (input.title !== undefined && typeof input.title !== 'string') {
            throw new Error('memory write "title" must be a string when provided.')
          }
          const result = await writeMemoryEntry({
            beforeMutation: (absolutePath) => captureCheckpointFileStateIfNeeded(context.checkpointId, absolutePath),
            content: input.content,
            path: input.path,
            ...(typeof input.title === 'string' ? { title: input.title } : {}),
            workspaceRootPath: context.workspaceRootPath,
          })
          return createSuccessResult({
            body: `${result.operation}: ${result.path}`,
            semantics: { action, operation: result.operation, path: result.path },
            subject: { kind: 'memory', path: result.path },
            summary: `${result.operation === 'unchanged' ? 'Kept' : 'Recorded'} workspace memory: ${result.path}`,
          })
        }

        if (action === 'edit') {
          if (typeof input.old_text !== 'string' || typeof input.new_text !== 'string') {
            throw new Error('memory edit requires string "old_text" and "new_text".')
          }
          const result = await editMemoryEntry({
            beforeMutation: (absolutePath) => captureCheckpointFileStateIfNeeded(context.checkpointId, absolutePath),
            newText: input.new_text,
            oldText: input.old_text,
            path: input.path,
            workspaceRootPath: context.workspaceRootPath,
          })
          return createSuccessResult({
            body: `${result.operation}: ${result.path}`,
            semantics: { action, operation: result.operation, path: result.path },
            subject: { kind: 'memory', path: result.path },
            summary: `${result.operation === 'unchanged' ? 'Kept' : 'Edited'} workspace memory: ${result.path}`,
          })
        }

        const result = await forgetMemoryEntry({
          beforeMutation: (absolutePath) => captureCheckpointFileStateIfNeeded(context.checkpointId, absolutePath),
          path: input.path,
          workspaceRootPath: context.workspaceRootPath,
        })
        return createSuccessResult({
          body: `deleted: ${result.path}`,
          semantics: { action, operation: result.operation, path: result.path },
          subject: { kind: 'memory', path: result.path },
          summary: `Forgot workspace memory: ${result.path}`,
        })
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Memory operation failed.'))
      }
    },
  })
}
