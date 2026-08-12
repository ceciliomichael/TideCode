import { jsonSchema, tool } from 'ai'
import type { AgentToolExecutionResult } from '../toolTypes'
import {
  createEditToolResult,
  WORKSPACE_PATH_DESCRIPTION,
  type WorkspaceToolContext,
  type EditOperationInput,
} from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

const EDIT_TOOL_DESCRIPTION =
  'Edit a file by replacing targetContent with replacementContent. Pass { path, edits: [{ targetContent, replacementContent }] }. Always use tools.edit for modifying existing files.'

const EDIT_PATH_SCHEMA = {
  description: WORKSPACE_PATH_DESCRIPTION,
  type: 'string',
}

const EDIT_OPERATION_SCHEMA = {
  additionalProperties: false,
  properties: {
    endLine: {
      description: 'Optional inclusive 1-indexed end line.',
      minimum: 1,
      type: 'integer',
    },
    replacementContent: {
      description: 'Replacement text.',
      type: 'string',
    },
    startLine: {
      description: 'Optional inclusive 1-indexed start line.',
      minimum: 1,
      type: 'integer',
    },
    targetContent: {
      description: 'Current source text to replace.',
      minLength: 1,
      type: 'string',
    },
  },
  required: ['targetContent', 'replacementContent'],
  type: 'object',
}

const EDIT_HUNKS_SCHEMA = {
  description: 'One or more hunks for the one file in path. Do not put paths inside hunks or combine files in one call.',
  items: EDIT_OPERATION_SCHEMA,
  minItems: 1,
  type: 'array',
}

const EDIT_INPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    edits: EDIT_HUNKS_SCHEMA,
    path: EDIT_PATH_SCHEMA,
  },
  required: ['path', 'edits'],
  type: 'object',
}

type EditToolInput = {
  path: string
  edits: EditOperationInput[]
}

interface RawEditInput {
  edits?: unknown
  path?: unknown
}

export function createEditTool(context: WorkspaceToolContext) {
  return tool({
    description: EDIT_TOOL_DESCRIPTION,
    inputSchema: jsonSchema<EditToolInput>(EDIT_INPUT_SCHEMA),
    execute: async (rawInput): Promise<AgentToolExecutionResult> => {
      const input = rawInput as RawEditInput
      const targetPath = requirePath(input.path)

      const normalizedInput: Parameters<typeof createEditToolResult>[1] = {
        edits: requireEditOperations(input.edits),
        path: targetPath,
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

function requireEditOperations(value: unknown): EditOperationInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Edit requires a non-empty edits array.')
  }

  return value.map((rawOperation, index) => {
    if (typeof rawOperation !== 'object' || rawOperation === null || Array.isArray(rawOperation)) {
      throw new Error(`Edit hunk ${index + 1} must be an object.`)
    }

    const operation = rawOperation as Record<string, unknown>
    return {
      allowMultiple: typeof operation.allowMultiple === 'boolean' ? operation.allowMultiple : undefined,
      replaceAll: typeof operation.replaceAll === 'boolean' ? operation.replaceAll : undefined,
      ...requireLineBounds(operation.startLine, operation.endLine, `Edit hunk ${index + 1}`),
      replacementContent: requireReplacementContent(operation.replacementContent),
      targetContent: requireTargetContent(operation.targetContent),
    }
  })
}

function requireLineBounds(startLine: unknown, endLine: unknown, label: string) {
  if ((startLine === undefined) !== (endLine === undefined)) {
    throw new Error(`${label} must provide both startLine and endLine when using a line range.`)
  }

  if (startLine === undefined && endLine === undefined) {
    return { endLine: undefined, startLine: undefined }
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

  return { endLine: endLine as number, startLine: startLine as number }
}
