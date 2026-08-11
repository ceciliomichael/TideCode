import { jsonSchema, tool } from 'ai'
import type { AgentToolExecutionResult } from '../toolTypes'
import {
  createEditToolResult,
  WORKSPACE_PATH_DESCRIPTION,
  type WorkspaceToolContext,
} from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

const EDIT_TOOL_DESCRIPTION =
  'Replace one unique text block in a file. Exact text is matched first; indentation, line-ending, and line-edge whitespace differences are tolerated when they still identify one unambiguous block.'

const EDIT_PATH_SCHEMA = {
  description: WORKSPACE_PATH_DESCRIPTION,
  type: 'string',
}

const EDIT_OPERATION_SCHEMA = {
  additionalProperties: false,
  properties: {
    allowMultiple: {
      description: 'Replace every match.',
      type: 'boolean',
    },
    endLine: {
      description: 'Optional 1-indexed end line; use with startLine.',
      minimum: 1,
      type: 'integer',
    },
    replacementContent: {
      description: 'Replacement text; empty deletes the target.',
      type: 'string',
    },
    startLine: {
      description: 'Optional 1-indexed start line; use with endLine.',
      minimum: 1,
      type: 'integer',
    },
    targetContent: {
      description: 'Current text from the latest read. Matching tries exact text first and tolerates indentation, line-ending, and line-edge whitespace differences when the block remains unique.',
      minLength: 1,
      type: 'string',
    },
  },
  required: ['targetContent', 'replacementContent'],
  type: 'object',
}

const EDIT_INPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    allowMultiple: EDIT_OPERATION_SCHEMA.properties.allowMultiple,
    endLine: EDIT_OPERATION_SCHEMA.properties.endLine,
    path: EDIT_PATH_SCHEMA,
    replacementContent: EDIT_OPERATION_SCHEMA.properties.replacementContent,
    startLine: EDIT_OPERATION_SCHEMA.properties.startLine,
    targetContent: EDIT_OPERATION_SCHEMA.properties.targetContent,
  },
  required: ['path', 'targetContent', 'replacementContent'],
  type: 'object',
}

type EditOperationInput = {
  allowMultiple: boolean
  endLine?: number
  replacementContent: string
  startLine?: number
  targetContent: string
}

type EditToolInput = { path: string } & EditOperationInput

interface RawEditInput {
  allowMultiple?: unknown
  endLine?: unknown
  path?: unknown
  replacementContent?: unknown
  startLine?: unknown
  targetContent?: unknown
}

export function createEditTool(context: WorkspaceToolContext) {
  return tool({
    description: EDIT_TOOL_DESCRIPTION,
    inputSchema: jsonSchema<EditToolInput>(EDIT_INPUT_SCHEMA),
    execute: async (rawInput): Promise<AgentToolExecutionResult> => {
      const input = rawInput as RawEditInput
      const targetPath = requirePath(input.path)

      const normalizedInput: Parameters<typeof createEditToolResult>[1] = {
        allowMultiple: normalizeAllowMultiple(input.allowMultiple, 'Edit'),
        ...normalizeLineBounds(input.startLine, input.endLine, 'Edit'),
        path: targetPath,
        replacementContent: requireReplacementContent(input.replacementContent),
        targetContent: requireTargetContent(input.targetContent),
      }

      try {
        return await createEditToolResult(context, normalizedInput)
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Edit failed.'))
      }
    },
  })
}

function requirePath(value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Edit requires a non-empty "path".')
  }
  return value
}

function requireTargetContent(value: unknown) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Edit requires non-empty "targetContent" copied from the latest read result.')
  }
  return value
}

function requireReplacementContent(value: unknown) {
  if (typeof value !== 'string') {
    throw new Error('Edit requires "replacementContent". Use an empty string when deleting the target.')
  }
  return value
}

function normalizeAllowMultiple(value: unknown, label: string) {
  if (value === undefined) return false
  if (typeof value !== 'boolean') {
    throw new Error(`${label} field "allowMultiple" must be a boolean when provided.`)
  }
  return value
}

function normalizeLineBounds(startLine: unknown, endLine: unknown, label: string) {
  if (startLine === undefined && endLine === undefined) {
    return { endLine: undefined, startLine: undefined }
  }

  if ((startLine === undefined) !== (endLine === undefined)) {
    throw new Error(`${label} must provide both startLine and endLine when using a line range.`)
  }

  if (
    typeof startLine !== 'number' ||
    !Number.isInteger(startLine) ||
    startLine < 1 ||
    typeof endLine !== 'number' ||
    !Number.isInteger(endLine) ||
    endLine < 1
  ) {
    throw new Error(`${label} requires integer startLine and endLine values of at least 1 when using a line range.`)
  }

  return { endLine, startLine }
}
