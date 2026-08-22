import { jsonSchema, tool } from 'ai'
import type { AgentToolExecutionResult } from '../toolTypes'
import {
  createEditToolResult,
  WORKSPACE_PATH_DESCRIPTION,
  type WorkspaceToolContext,
  type EditOperationInput,
} from './workspaceTools'
import {
  createWorkspaceMutationErrorResult,
  WorkspaceMutationError,
} from './workspaceMutationErrors'

const EDIT_TOOL_DESCRIPTION =
  'Edit an existing file with structured source text by replacing targetContent with replacementContent. Ambiguous targets fail unless replaceAll is explicitly true. Pass expectedRevision from the latest read when available.'

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
    replaceAll: {
      description: 'Replace every matching occurrence. Defaults to false so ambiguous targets fail safely.',
      type: 'boolean',
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
    expectedRevision: {
      description: 'Optional sha256 revision returned by the latest read of this file. The edit fails if the file changed since that read.',
      minLength: 1,
      type: 'string',
    },
    path: EDIT_PATH_SCHEMA,
  },
  required: ['path', 'edits'],
  type: 'object',
}

type EditToolInput = {
  path: string
  edits: EditOperationInput[]
  expectedRevision?: string
}

interface RawEditInput {
  edits?: unknown
  expectedRevision?: unknown
  path?: unknown
}

export function createEditTool(context: WorkspaceToolContext) {
  return tool({
    description: EDIT_TOOL_DESCRIPTION,
    inputSchema: jsonSchema<EditToolInput>(EDIT_INPUT_SCHEMA),
    execute: async (rawInput): Promise<AgentToolExecutionResult> => {
      try {
        const input = rawInput as RawEditInput
        const normalizedInput: Parameters<typeof createEditToolResult>[1] = {
          edits: requireEditOperations(input.edits),
          expectedRevision: requireOptionalRevision(input.expectedRevision),
          path: requirePath(input.path),
        }
        return await createEditToolResult(context, normalizedInput)
      } catch (error) {
        return createWorkspaceMutationErrorResult(error, 'Edit failed.')
      }
    },
  })
}

function requirePath(value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0) {
throw new WorkspaceMutationError('INVALID_ARGUMENT', 'INPUT_VALIDATION', 'Edit requires a non-empty "path".')
  }
  return value
}

function requireTargetContent(value: unknown) {
  if (typeof value !== 'string' || value.length === 0) {
throw new WorkspaceMutationError('INVALID_ARGUMENT', 'INPUT_VALIDATION', 'Edit requires non-empty "targetContent" copied from the latest read result.')
  }
  return value
}

function requireReplacementContent(value: unknown) {
  if (typeof value !== 'string') {
throw new WorkspaceMutationError('INVALID_ARGUMENT', 'INPUT_VALIDATION', 'Edit requires "replacementContent". Use an empty string when deleting the target.')
  }
  return value
}

function requireEditOperations(value: unknown): EditOperationInput[] {
  if (!Array.isArray(value) || value.length === 0) {
throw new WorkspaceMutationError('INVALID_ARGUMENT', 'INPUT_VALIDATION', 'Edit requires a non-empty edits array.')
  }

  return value.map((rawOperation, index) => {
    if (typeof rawOperation !== 'object' || rawOperation === null || Array.isArray(rawOperation)) {
throw new WorkspaceMutationError('INVALID_ARGUMENT', 'INPUT_VALIDATION', `Edit hunk ${index + 1} must be an object.`)
    }

    const operation = rawOperation as Record<string, unknown>
    return {
      replaceAll: typeof operation.replaceAll === 'boolean' ? operation.replaceAll : undefined,
      ...requireLineBounds(operation.startLine, operation.endLine, `Edit hunk ${index + 1}`),
      replacementContent: requireReplacementContent(operation.replacementContent),
      targetContent: requireTargetContent(operation.targetContent),
    }
  })
}

function requireOptionalRevision(value: unknown) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new WorkspaceMutationError('INVALID_ARGUMENT', 'INPUT_VALIDATION', 'expectedRevision must be a non-empty revision string when provided.')
  }
  return value
}

function requireLineBounds(startLine: unknown, endLine: unknown, label: string) {
  if ((startLine === undefined) !== (endLine === undefined)) {
throw new WorkspaceMutationError('INVALID_ARGUMENT', 'INPUT_VALIDATION', `${label} must provide both startLine and endLine when using a line range.`)
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
throw new WorkspaceMutationError('INVALID_ARGUMENT', 'INPUT_VALIDATION', `${label} requires integer startLine and endLine values of at least 1 when using a line range.`)
  }

  return { endLine: endLine as number, startLine: startLine as number }
}
