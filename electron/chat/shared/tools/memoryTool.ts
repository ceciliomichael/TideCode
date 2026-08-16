import { jsonSchema, tool } from 'ai'
import {
  editMemoryEntry,
  forgetMemoryEntry,
  writeMemoryEntry,
} from '../../../memory/service'
import { WORKSPACE_PATH_DESCRIPTION, type WorkspaceToolContext } from './workspaceToolPaths'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'
import { captureCheckpointFileStateIfNeeded, createSuccessResult } from './workspaceToolResults'

type MemoryAction = 'edit' | 'forget' | 'write'

interface MemoryToolInput {
  action?: string
  content?: string
  new_text?: string
  old_text?: string
  path?: string
  title?: string
}

function isMemoryAction(action: string): action is MemoryAction {
  return action === 'write' || action === 'edit' || action === 'forget'
}

export function createMemoryTool(context: WorkspaceToolContext) {
  return tool({
    description: 'Maintain durable workspace memory under .tidecode/memory/. Use the normal read tool to inspect the memory index and entries.',
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        action: {
          description: 'write creates or replaces; edit replaces one exact text block; forget removes.',
          enum: ['write', 'edit', 'forget'],
          type: 'string',
        },
        content: { description: 'Complete Markdown content for write.', type: 'string' },
        new_text: { description: 'Replacement text for edit; may be empty.', type: 'string' },
        old_text: { description: 'One exact unique text block for edit.', type: 'string' },
        path: {
          description: `${WORKSPACE_PATH_DESCRIPTION} The target must be a memory entry under .tidecode/memory/folders/, ending in .md. Required for every action.`,
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
        if (!isMemoryAction(action)) {
          throw new Error(`Unsupported memory action: ${action}. Use write, edit, or forget.`)
        }
        if (typeof input.path !== 'string' || input.path.trim().length === 0) {
          throw new Error(`memory ${action} requires "path".`)
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
