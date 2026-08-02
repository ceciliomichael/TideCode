import { jsonSchema, tool } from 'ai'
import type { AgentToolExecutionResult } from '../toolTypes'
import { createEditToolResult, type WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

const EDIT_TOOL_DESCRIPTION =
  'Replace exact text in a file.'

const EDIT_PATH_SCHEMA = {
  description: 'File path.',
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
      description: 'Exact current text from the latest read.',
      minLength: 1,
      type: 'string',
    },
  },
  required: ['targetContent', 'replacementContent'],
  type: 'object',
}

const EDIT_INPUT_SCHEMA = {
  properties: {
    path: EDIT_PATH_SCHEMA,
  },
  required: ['path'],
  oneOf: [
    {
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
    },
    {
      additionalProperties: false,
      properties: {
        edits: {
          description: 'Exact replacements for the top-level path.',
          items: EDIT_OPERATION_SCHEMA,
          maxItems: 20,
          minItems: 1,
          type: 'array',
        },
        path: EDIT_PATH_SCHEMA,
      },
      required: ['path', 'edits'],
      type: 'object',
    },
  ],
  type: 'object',
}

type EditOperationInput = {
  allowMultiple: boolean
  endLine?: number
  replacementContent: string
  startLine?: number
  targetContent: string
}

type EditToolInput =
  | ({ path: string } & EditOperationInput)
  | { edits: EditOperationInput[]; path: string }

interface RawEditInput {
  allowMultiple?: unknown
  edits?: unknown
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

      let normalizedInput: Parameters<typeof createEditToolResult>[1]
      if (input.edits !== undefined) {
        if (!Array.isArray(input.edits) || input.edits.length === 0 || input.edits.length > 20) {
          throw new Error('Edit requires between 1 and 20 items in "edits".')
        }

        normalizedInput = {
          edits: input.edits.map((operation, index) => normalizeEditOperation(operation, index)),
          path: targetPath,
        }
      } else {
        normalizedInput = {
          allowMultiple: normalizeAllowMultiple(input.allowMultiple, 'Edit'),
          ...normalizeLineBounds(input.startLine, input.endLine, 'Edit'),
          path: targetPath,
          replacementContent: requireReplacementContent(input.replacementContent),
          targetContent: requireTargetContent(input.targetContent),
        }
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

function normalizeEditOperation(value: unknown, index: number): EditOperationInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Edit operation ${index + 1} must be an object.`)
  }

  const operation = value as RawEditInput
  return {
    allowMultiple: normalizeAllowMultiple(operation.allowMultiple, `Edit operation ${index + 1}`),
    ...normalizeLineBounds(operation.startLine, operation.endLine, `Edit operation ${index + 1}`),
    replacementContent: requireReplacementContent(operation.replacementContent),
    targetContent: requireTargetContent(operation.targetContent),
  }
}
