import { asSchema, type ToolExecutionOptions, type ToolSet } from 'ai'
import type { JSONSchema7 } from '@ai-sdk/provider'
import Ajv, { type ValidateFunction } from 'ajv'
import type { AgentToolExecutionResult } from '../toolTypes'
import { normalizeToolExecutionResult, prepareToolExecutionResultForModel } from '../toolReplay'
import { createToolErrorResult } from './toolResult'

export interface AgentToolRegistryExecutionOptions {
  abortSignal?: AbortSignal
  toolCallId?: string
}

export interface AgentToolRegistryEntry {
  description: string
  execute: (input: unknown, options?: AgentToolRegistryExecutionOptions) => Promise<AgentToolExecutionResult>
  inputSchema: JSONSchema7
  name: string
  namespace: string
}

export interface AgentToolSearchMatch {
  description: string
  inputSchema: JSONSchema7
  name: string
  namespace: string
  score: number
}

const CODE_MODE_EDIT_DESCRIPTION =
  'Edit one existing file using hunks shaped as { target, replacement }, { startLine, endLine, replacement }, or { insertAt, content }; replaceAll is explicit.'

const CODE_MODE_APPLY_PATCH_DESCRIPTION =
  'Apply one raw Codex-style patch string beginning with *** Begin Patch and ending with *** End Patch. Complete patch templates passed to apply_patch are treated as literal patch data, so nested backticks, ${...}, \\n-style source text, regex escapes, JSX/TSX quotes, and Windows paths do not need double escaping. If a generated anchor still contains one redundant escaping layer, TideCode repairs it only when there is one unique non-overlapping source match. Use fresh source context; TideCode verifies the full patch before writing.'

const CODE_MODE_APPLY_PATCH_INPUT_SCHEMA: JSONSchema7 = {
  description: 'Raw Codex-style patch text. Do not wrap it in an object, array, or Markdown fence.',
  minLength: 1,
  type: 'string',
}

const CODE_MODE_EDIT_OPERATION_SCHEMA: JSONSchema7 = {
  additionalProperties: false,
  allOf: [{
    oneOf: [
      {
        not: {
          anyOf: [
            { required: ['insertAt'] },
            { required: ['content'] },
          ],
        },
        required: ['target', 'replacement'],
      },
      {
        not: {
          anyOf: [
            { required: ['target'] },
            { required: ['replaceAll'] },
            { required: ['insertAt'] },
            { required: ['content'] },
          ],
        },
        required: ['startLine', 'endLine', 'replacement'],
      },
      {
        not: {
          anyOf: [
            { required: ['target'] },
            { required: ['replacement'] },
            { required: ['startLine'] },
            { required: ['endLine'] },
            { required: ['replaceAll'] },
          ],
        },
        required: ['insertAt', 'content'],
      },
    ],
  }],
  description: 'Use exactly one semantic form: { target, replacement }, { startLine, endLine, replacement }, or { insertAt, content }. Text replacement may also include startLine/endLine bounds and replaceAll.',
  properties: {
    content: {
      description: 'Content inserted at the selected file boundary.',
      minLength: 1,
      type: 'string',
    },
    endLine: {
      description: 'Inclusive 1-indexed end line for an exact range or optional text-match constraint.',
      minimum: 1,
      type: 'integer',
    },
    insertAt: {
      description: 'Exact file boundary for insertion.',
      enum: ['start', 'end'],
      type: 'string',
    },
    replaceAll: {
      description: 'Replace every matching text occurrence. Valid only with target.',
      type: 'boolean',
    },
    replacement: {
      description: 'Replacement text. Use an empty string to delete a text target or exact line range.',
      type: 'string',
    },
    startLine: {
      description: 'Inclusive 1-indexed start line for an exact range or optional text-match constraint.',
      minimum: 1,
      type: 'integer',
    },
    target: {
      description: 'Exact current source text to replace.',
      minLength: 1,
      type: 'string',
    },
  },
  type: 'object',
}

function createCodeModeEditInputSchema(nativeInputSchema: JSONSchema7): JSONSchema7 {
  const nativeProperties = nativeInputSchema.properties && typeof nativeInputSchema.properties === 'object' && !Array.isArray(nativeInputSchema.properties)
    ? nativeInputSchema.properties
    : {}

  return {
    additionalProperties: false,
    properties: {
      edits: {
        description: 'One or more semantic edit hunks for the single file in path.',
        items: CODE_MODE_EDIT_OPERATION_SCHEMA,
        minItems: 1,
        type: 'array',
      },
      ...(nativeProperties.path ? { path: nativeProperties.path } : { path: { type: 'string' } }),
    },
    required: ['path', 'edits'],
    type: 'object',
  }
}

export interface AgentToolRegistry {
  entries: readonly AgentToolRegistryEntry[]
  get(name: string): AgentToolRegistryEntry | undefined
  search(query: string, namespace?: string, limit?: number): AgentToolSearchMatch[]
}

/** MCP capabilities are discovered on demand; local tools are preloaded into Code Mode. */
export function isDynamicAgentTool(entry: Pick<AgentToolRegistryEntry, 'namespace'>) {
  return entry.namespace === 'mcp'
}

function resolveToolNamespace(name: string) {
  const normalizedName = name.trim().toLowerCase()
  if (normalizedName.startsWith('mcp_') || normalizedName === 'execute_mcp') return 'mcp'
  if (normalizedName === 'run' || normalizedName.includes('terminal') || normalizedName.includes('command')) {
    return 'shell'
  }
  if (
    normalizedName === 'read' ||
    normalizedName === 'read_tool_output' ||
    normalizedName === 'write' ||
    normalizedName === 'edit' ||
    normalizedName === 'apply_patch' ||
    normalizedName === 'glob' ||
    normalizedName === 'grep' ||
    normalizedName === 'list'
  ) {
    return 'filesystem'
  }
  if (normalizedName === 'memory') return 'memory'
  if (normalizedName === 'skill') return 'skills'
  if (normalizedName.startsWith('git') || normalizedName.includes('commit')) return 'git'
  if (normalizedName.startsWith('plan')) return 'planning'
  if (normalizedName.startsWith('kanban')) return 'kanban'
  return 'workspace'
}

function getToolDescription(tool: ToolSet[string], name: string) {
  if (typeof tool.description === 'string' && tool.description.trim().length > 0) {
    return tool.description.trim()
  }

  return `Execute the ${name} workspace operation.`
}

async function getToolInputSchema(tool: ToolSet[string]) {
  const schema = asSchema(tool.inputSchema)
  return (await schema.jsonSchema) as JSONSchema7
}

function isExecutableTool(tool: ToolSet[string]): tool is ToolSet[string] & {
  execute: (input: unknown, options: ToolExecutionOptions<unknown>) => unknown
} {
  return typeof tool.execute === 'function'
}

function decodeJsonPointer(instancePath: string) {
  if (instancePath.length === 0) return []
  return instancePath
    .slice(1)
    .split('/')
    .map((part) => part.replace(/~1/gu, '/').replace(/~0/gu, '~'))
}

function getValueAtPath(value: unknown, pathParts: string[]): unknown {
  let current = value
  for (const part of pathParts) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function omitUnsupportedFalseProperties(input: unknown, validateInput: ValidateFunction) {
  let normalizedInput = input

  for (;;) {
    if (validateInput(normalizedInput)) return normalizedInput

    const removablePaths = (validateInput.errors ?? []).flatMap((validationError) => {
      if (validationError.keyword !== 'additionalProperties') return []
      const additionalProperty = (validationError.params as { additionalProperty?: unknown }).additionalProperty
      if (typeof additionalProperty !== 'string') return []

      const parentPath = decodeJsonPointer(validationError.instancePath)
      const parentValue = getValueAtPath(normalizedInput, parentPath)
      if (!parentValue || typeof parentValue !== 'object' || Array.isArray(parentValue)) return []
      if ((parentValue as Record<string, unknown>)[additionalProperty] !== false) return []

      return [[...parentPath, additionalProperty]]
    })

    if (removablePaths.length === 0) return normalizedInput

    const nextInput = structuredClone(normalizedInput)
    let removedAny = false
    for (const propertyPath of removablePaths) {
      const parentPath = propertyPath.slice(0, -1)
      const propertyName = propertyPath.at(-1)
      const parentValue = getValueAtPath(nextInput, parentPath)
      if (!propertyName || !parentValue || typeof parentValue !== 'object' || Array.isArray(parentValue)) continue
      if ((parentValue as Record<string, unknown>)[propertyName] !== false) continue
      delete (parentValue as Record<string, unknown>)[propertyName]
      removedAny = true
    }

    if (!removedAny) return normalizedInput
    normalizedInput = nextInput
  }
}

function applyEditFieldAlias(
  edit: Record<string, unknown>,
  alias: string,
  canonical: string,
) {
  if (!(alias in edit)) return false
  if (!(canonical in edit)) {
    edit[canonical] = edit[alias]
    delete edit[alias]
    return true
  }
  if (edit[canonical] === edit[alias]) {
    delete edit[alias]
    return true
  }
  return false
}

function normalizeCodeModeEditInput(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input

  const record = input as Record<string, unknown>
  if (typeof record.path !== 'string' || !Array.isArray(record.edits)) return input

  let changed = false
  const edits = record.edits.map((rawEdit) => {
    if (!rawEdit || typeof rawEdit !== 'object' || Array.isArray(rawEdit)) return rawEdit

    const edit = { ...(rawEdit as Record<string, unknown>) }
    if ('path' in edit && edit.path === record.path) {
      delete edit.path
      changed = true
    }

    for (const [alias, canonical] of [
      ['target', 'targetContent'],
      ['replacement', 'replacementContent'],
      ['oldText', 'targetContent'],
      ['newText', 'replacementContent'],
      ['lineStart', 'startLine'],
      ['lineEnd', 'endLine'],
    ] as const) {
      changed = applyEditFieldAlias(edit, alias, canonical) || changed
    }

    if ('insertAt' in edit || 'insertContent' in edit) {
      changed = applyEditFieldAlias(edit, 'content', 'insertContent') || changed
    }

    return edit
  })

  return changed ? { ...record, edits } : input
}

function normalizeCodeModeInput(
  name: string,
  input: unknown,
  inputSchema: JSONSchema7,
  validateInput: ValidateFunction,
) {
  let normalizedInput = name === 'edit'
    ? normalizeCodeModeEditInput(input)
    : name === 'apply_patch' && typeof input === 'string'
      ? { patch: input.split(/\r?\n/u) }
      : input
  if (normalizedInput && typeof normalizedInput === 'object' && !Array.isArray(normalizedInput)) {
    const properties = inputSchema.properties
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
      const offsetSchema = properties.offset
      const record = normalizedInput as Record<string, unknown>
      if (offsetSchema && typeof offsetSchema === 'object' && !Array.isArray(offsetSchema) &&
          offsetSchema.minimum === 1 && record.offset === 0) {
        // Code Mode models often use zero-based offsets. The concrete read APIs are
        // intentionally one-based, so map the harmless first-line spelling here.
        normalizedInput = { ...record, offset: 1 }
      }
    }
  }

  // A false value for a property that the concrete tool schema does not support
  // is equivalent to omitting that optional capability. Strip only properties
  // Ajv identifies as additional, and only when their value is exactly false.
  // Supported false values and unsupported truthy values are preserved.
  return omitUnsupportedFalseProperties(normalizedInput, validateInput)
}

function scoreMatch(entry: AgentToolRegistryEntry, queryTerms: string[]) {
  const name = entry.name.toLowerCase()
  const namespace = entry.namespace.toLowerCase()
  const description = entry.description.toLowerCase()
  let score = 0

  for (const term of queryTerms) {
    if (name === term) score += 100
    else if (name.includes(term)) score += 50
    if (namespace === term) score += 30
    else if (namespace.includes(term)) score += 15
    if (description.includes(term)) score += 10
  }

  return score
}

export async function createAgentToolRegistry(nativeTools: ToolSet): Promise<AgentToolRegistry> {
  const entries: AgentToolRegistryEntry[] = []
  const ajv = new Ajv({ allErrors: true, strict: false })

  for (const [name, tool] of Object.entries(nativeTools)) {
    if (!isExecutableTool(tool)) {
      continue
    }

    let nativeInputSchema: JSONSchema7
    let validateInput: ValidateFunction
    try {
      nativeInputSchema = await getToolInputSchema(tool)
      validateInput = ajv.compile(nativeInputSchema)
    } catch (error) {
      console.warn(`Skipping ${name} from the Code Mode registry because its schema could not be resolved.`, error)
      continue
    }

    const execute = tool.execute
    const modelInputSchema = name === 'edit'
      ? createCodeModeEditInputSchema(nativeInputSchema)
      : name === 'apply_patch'
        ? CODE_MODE_APPLY_PATCH_INPUT_SCHEMA
        : nativeInputSchema
    entries.push({
      description: name === 'edit'
        ? CODE_MODE_EDIT_DESCRIPTION
        : name === 'apply_patch'
          ? CODE_MODE_APPLY_PATCH_DESCRIPTION
          : getToolDescription(tool, name),
      execute: async (input, options = {}) => {
        const normalizedInput = normalizeCodeModeInput(name, input, nativeInputSchema, validateInput)
        if (!validateInput(normalizedInput)) {
          const validationDetails = (validateInput.errors ?? [])
            .map((validationError) => `${validationError.instancePath || '/'} ${validationError.message ?? 'is invalid'}`)
            .join('; ')
          return createToolErrorResult(
            `Invalid arguments for ${name}${validationDetails ? `: ${validationDetails}` : '.'}`,
            undefined,
            name === 'edit'
              ? { error_code: 'INVALID_ARGUMENT', stage: 'INPUT_VALIDATION' }
              : undefined,
          )
        }

        const toolOptions: ToolExecutionOptions<unknown> = {
          abortSignal: options.abortSignal,
          context: {},
          messages: [],
          toolCallId: options.toolCallId ?? `code-mode-${name}`,
        }
        const output = await execute(normalizedInput, toolOptions)
        const normalizedOutput = normalizeToolExecutionResult(name, output)
        const boundedOutput = await prepareToolExecutionResultForModel({
          result: normalizedOutput,
          toolName: name,
        })
        return normalizedOutput.body !== undefined && normalizedOutput.displayBody === undefined
          ? { ...boundedOutput, displayBody: normalizedOutput.body }
          : boundedOutput
      },
      inputSchema: modelInputSchema,
      name,
      namespace: resolveToolNamespace(name),
    })
  }

  const entryByName = new Map(entries.map((entry) => [entry.name, entry]))
  return {
    entries: Object.freeze(entries),
    get(name) {
      return entryByName.get(name)
    },
    search(query, namespace, limit = 10) {
      const normalizedQuery = query.trim().toLowerCase()
      const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean)
      const normalizedNamespace = namespace?.trim().toLowerCase()
      return entries
        .map((entry) => ({
          description: entry.description,
          inputSchema: entry.inputSchema,
          name: entry.name,
          namespace: entry.namespace,
          score: scoreMatch(entry, queryTerms) +
            (normalizedNamespace && entry.namespace === normalizedNamespace ? 1000 : 0),
        }))
        .filter((entry) => {
          if (normalizedNamespace && entry.namespace !== normalizedNamespace) return false
          return normalizedQuery.length === 0 || entry.score > 0
        })
        .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
        .slice(0, Math.max(1, Math.min(20, Math.floor(limit))))
    },
  }
}
