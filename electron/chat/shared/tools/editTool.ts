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
  'Edit an existing file using one exact operation per hunk: replace targetContent, replace an exact startLine/endLine range, or insert insertContent at the file start/end. Ambiguous text targets return recoverable candidate context unless replaceAll is explicitly true.'

const EDIT_PATH_SCHEMA = {
  description: WORKSPACE_PATH_DESCRIPTION,
  type: 'string',
}

const EDIT_OPERATION_SCHEMA = {
  additionalProperties: false,
  allOf: [{
    oneOf: [
      {
        not: {
          anyOf: [
            { required: ['insertContent'] },
            { required: ['insertAt'] },
          ],
        },
        required: ['targetContent', 'replacementContent'],
      },
      {
        not: {
          anyOf: [
            { required: ['targetContent'] },
            { required: ['replaceAll'] },
            { required: ['insertContent'] },
            { required: ['insertAt'] },
          ],
        },
        required: ['startLine', 'endLine', 'replacementContent'],
      },
      {
        not: {
          anyOf: [
            { required: ['targetContent'] },
            { required: ['replacementContent'] },
            { required: ['startLine'] },
            { required: ['endLine'] },
            { required: ['replaceAll'] },
          ],
        },
        required: ['insertContent', 'insertAt'],
      },
    ],
  }],
  description: 'Use targetContent + replacementContent for text replacement, startLine + endLine + replacementContent for exact range replacement, or insertContent + insertAt for exact boundary insertion.',
  properties: {
    endLine: {
      description: 'Inclusive 1-indexed end line. With targetContent it constrains matching; without targetContent it defines the exact range to replace.',
      minimum: 1,
      type: 'integer',
    },
    insertAt: {
      description: 'Exact file boundary for insertion.',
      enum: ['start', 'end'],
      type: 'string',
    },
    insertContent: {
      description: 'Content to insert exactly at the selected file boundary.',
      minLength: 1,
      type: 'string',
    },
    replaceAll: {
      description: 'Replace every matching text occurrence. Valid only with targetContent.',
      type: 'boolean',
    },
    replacementContent: {
      description: 'Replacement text. Use an empty string to delete the matched text or exact line range.',
      type: 'string',
    },
    startLine: {
      description: 'Inclusive 1-indexed start line. With targetContent it constrains matching; without targetContent it defines the exact range to replace.',
      minimum: 1,
      type: 'integer',
    },
    targetContent: {
      description: 'Exact current source text to replace. Omit for exact range replacement or boundary insertion.',
      minLength: 1,
      type: 'string',
    },
  },
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
      try {
        const input = rawInput as RawEditInput
        const normalizedInput: Parameters<typeof createEditToolResult>[1] = {
          edits: requireEditOperations(input.edits),
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
    const label = `Edit hunk ${index + 1}`
    const hasInsertionFields = operation.insertContent !== undefined || operation.insertAt !== undefined

    if (hasInsertionFields) {
      if (typeof operation.insertContent !== 'string' || operation.insertContent.length === 0) {
        throw new WorkspaceMutationError('INVALID_ARGUMENT', 'INPUT_VALIDATION', `${label} requires non-empty insertContent when using insertion.`)
      }
      if (operation.insertAt !== 'start' && operation.insertAt !== 'end') {
        throw new WorkspaceMutationError('INVALID_ARGUMENT', 'INPUT_VALIDATION', `${label} requires insertAt to be "start" or "end" when using insertion.`)
      }
      if (
        operation.targetContent !== undefined ||
        operation.replacementContent !== undefined ||
        operation.startLine !== undefined ||
        operation.endLine !== undefined ||
        operation.replaceAll !== undefined
      ) {
        throw new WorkspaceMutationError('INVALID_ARGUMENT', 'INPUT_VALIDATION', `${label} cannot combine insertion with replacement fields.`)
      }
      return {
        insertAt: operation.insertAt,
        insertContent: operation.insertContent,
      }
    }

    const lineBounds = requireLineBounds(operation.startLine, operation.endLine, label)
    const replacementContent = requireReplacementContent(operation.replacementContent)

    if (operation.targetContent === undefined) {
      if (lineBounds.startLine === undefined || lineBounds.endLine === undefined) {
        throw new WorkspaceMutationError('INVALID_ARGUMENT', 'INPUT_VALIDATION', `${label} requires targetContent, an exact startLine/endLine range, or insertion fields.`)
      }
      if (operation.replaceAll !== undefined) {
        throw new WorkspaceMutationError('INVALID_ARGUMENT', 'INPUT_VALIDATION', `${label} cannot use replaceAll with an exact range replacement.`)
      }
      return {
        ...lineBounds,
        replacementContent,
      }
    }

    return {
      replaceAll: typeof operation.replaceAll === 'boolean' ? operation.replaceAll : undefined,
      ...lineBounds,
      replacementContent,
      targetContent: requireTargetContent(operation.targetContent),
    }
  })
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
    endLine < 1 ||
    endLine < startLine
  ) {
throw new WorkspaceMutationError('INVALID_ARGUMENT', 'INPUT_VALIDATION', `${label} requires integer startLine and endLine values of at least 1 when using a line range.`)
  }

  return { endLine: endLine as number, startLine: startLine as number }
}
