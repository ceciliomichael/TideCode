import { jsonSchema, tool, type ToolSet } from 'ai'
import { normalizeToolExecutionResult } from '../toolReplay'
import type { AgentToolExecutionResult } from '../toolTypes'
import {
  DYNAMIC_EXECUTE_TOOL_NAME,
  DYNAMIC_SCHEMA_BATCH_SIZE,
  DYNAMIC_TOOL_PAGE_SIZE,
  isRecord,
  type DynamicExecuteInput,
  type DynamicListInput,
  type DynamicSchemaInput,
  type DynamicToolCatalogEntry,
  type DynamicToolInvocationMetadata,
} from './dynamicToolContracts'
import {
  compileJsonSchema,
  getFirstValidationError,
  type CompiledJsonSchemaValidator,
  type JsonSchemaCompilationResult,
} from './dynamicToolValidation'
import { normalizeDynamicExecuteInput } from './dynamicToolInput'
import { searchToolCatalog } from './dynamicToolSearch'

const DYNAMIC_LIST_SCHEMA = {
  additionalProperties: false,
  properties: {
    page: {
      description: '1-indexed result page.',
      minimum: 1,
      type: 'integer',
    },
    query: {
      description: 'Natural-language text describing the capability to find.',
      type: 'string',
    },
  },
  type: 'object',
}

const DYNAMIC_SCHEMA_SCHEMA = {
  additionalProperties: false,
  oneOf: [
    {
      additionalProperties: false,
      properties: {
        id: {
          description: 'Exact catalog tool identifier.',
          minLength: 1,
          type: 'string',
        },
      },
      required: ['id'],
      type: 'object',
    },
    {
      additionalProperties: false,
      properties: {
        ids: {
          description: `Exact catalog tool identifiers. Fetch up to ${DYNAMIC_SCHEMA_BATCH_SIZE} schemas in one call.`,
          items: { minLength: 1, type: 'string' },
          maxItems: DYNAMIC_SCHEMA_BATCH_SIZE,
          minItems: 1,
          type: 'array',
        },
      },
      required: ['ids'],
      type: 'object',
    },
  ],
  properties: {
    id: {
      description: 'Exact catalog tool identifier.',
      minLength: 1,
      type: 'string',
    },
    ids: {
      description: `Exact catalog tool identifiers. Fetch up to ${DYNAMIC_SCHEMA_BATCH_SIZE} schemas in one call.`,
      items: { minLength: 1, type: 'string' },
      maxItems: DYNAMIC_SCHEMA_BATCH_SIZE,
      minItems: 1,
      type: 'array',
    },
  },
  type: 'object',
}

const DYNAMIC_EXECUTE_SCHEMA = {
  additionalProperties: false,
  properties: {
    args: {
      description:
        'Native arguments for the selected catalog tool. Keep id and args as separate top-level properties; do not put id inside args.',
      type: 'object',
    },
    id: {
      description: 'Catalog tool identifier. This is a sibling of args at the top level.',
      minLength: 1,
      type: 'string',
    },
  },
  required: ['id', 'args'],
  type: 'object',
}

function requireCompiledSchema(schema: Record<string, unknown>) {
  const result = compileJsonSchema(schema)
  if (!result.success) {
    throw new Error(`Invalid internal dynamic tool schema: ${result.error}`)
  }
  return result.validator
}

const LIST_INPUT_VALIDATOR = requireCompiledSchema(DYNAMIC_LIST_SCHEMA)
const SCHEMA_INPUT_VALIDATOR = requireCompiledSchema(DYNAMIC_SCHEMA_SCHEMA)
const EXECUTE_INPUT_VALIDATOR = requireCompiledSchema(DYNAMIC_EXECUTE_SCHEMA)

function validateMetaInput(value: unknown, validator: CompiledJsonSchemaValidator) {
  const message = getFirstValidationError(validator.validate(value))
  return message
    ? {
        error: new Error(`Invalid dynamic tool input: ${message}`),
        success: false as const,
      }
    : { success: true as const, value }
}

function validateDynamicExecuteInput(value: unknown) {
  const normalizedInput = normalizeDynamicExecuteInput(value)
  if (!normalizedInput) {
    return {
      error: new Error('Invalid dynamic tool input: execute_tool requires top-level id and args properties.'),
      success: false as const,
    }
  }

  return validateMetaInput(normalizedInput, EXECUTE_INPUT_VALIDATOR)
}

function getCatalogEntry(catalog: ReadonlyMap<string, DynamicToolCatalogEntry>, id: string) {
  const normalizedId = id.trim()
  return normalizedId.length > 0 ? (catalog.get(normalizedId) ?? null) : null
}

function getUnknownToolErrorResult(catalogEntries: readonly DynamicToolCatalogEntry[], requestedId: string) {
  const summary = `Tool "${requestedId}" not found or not allowed.`
  const suggestions = searchToolCatalog(catalogEntries, requestedId, 1)
    .results.slice(0, 3)
    .map((result) => ({ id: result.id, name: result.name }))

  return errorResult(
    summary,
    jsonBody({
      error: summary,
      nextStep: 'Call list_tools to discover an exact tool id, then call get_tool_schema if you need to confirm its arguments before execute_tool.',
      requestedId,
      suggestions,
    }),
  )
}

function jsonBody(value: unknown) {
  return JSON.stringify(value)
}

function successResult(
  summary: string,
  body: string,
  extra: Partial<AgentToolExecutionResult> = {},
): AgentToolExecutionResult {
  return {
    ...extra,
    body,
    status: 'success',
    summary,
  }
}

function errorResult(
  summary: string,
  body?: string,
  extra: Partial<AgentToolExecutionResult> = {},
): AgentToolExecutionResult {
  return {
    ...extra,
    ...(body ? { body } : {}),
    status: 'error',
    summary,
  }
}

function parseDynamicExecuteInput(value: unknown): DynamicExecuteInput | null {
  return normalizeDynamicExecuteInput(value)
}

function parseDynamicSchemaInput(value: unknown): DynamicSchemaInput | null {
  if (!isRecord(value)) {
    return null
  }

  const hasId = typeof value.id === 'string'
  const hasIds = Array.isArray(value.ids)
  if (hasId === hasIds) {
    return null
  }

  if (hasId) {
    return { id: value.id as string }
  }

  const ids = Array.isArray(value.ids) ? value.ids : null
  if (!ids || ids.length < 1 || ids.length > DYNAMIC_SCHEMA_BATCH_SIZE) {
    return null
  }

  const stringIds = ids.filter((id): id is string => typeof id === 'string')
  if (stringIds.length !== ids.length || stringIds.some((id) => id.trim().length === 0)) {
    return null
  }

  return { ids: [...stringIds] }
}

function createInvocationMetadata(toolName: string, argumentsValue: unknown): DynamicToolInvocationMetadata {
  return { argumentsValue, toolName }
}

function getSchemaPayload(entry: DynamicToolCatalogEntry) {
  return {
    description: entry.description,
    guidance: {
      safety: [...entry.guidance.safety],
      whenToUse: entry.guidance.whenToUse,
      workflow: [...entry.guidance.workflow],
    },
    id: entry.id,
    name: entry.name,
    parameters: entry.inputSchema,
    source: { ...entry.source },
    tags: [...entry.tags],
  }
}

function getSchemaResult(
  catalog: ReadonlyMap<string, DynamicToolCatalogEntry>,
  catalogValidators: ReadonlyMap<string, JsonSchemaCompilationResult>,
  discoveredToolIds: ReadonlySet<string>,
  requestedId: string,
) {
  const id = requestedId.trim()
  const entry = getCatalogEntry(catalog, id)
  if (!entry) {
    return {
      code: 'UNKNOWN_TOOL',
      error: `Tool "${requestedId}" not found or not allowed.`,
      id: requestedId,
      status: 'error' as const,
    }
  }
  if (!discoveredToolIds.has(entry.id)) {
    return {
      code: 'TOOL_NOT_DISCOVERED',
      error: `Tool "${entry.id}" must be returned by list_tools before its schema can be fetched.`,
      id: entry.id,
      nextStep: 'Call list_tools with a targeted capability query and use an exact returned id.',
      status: 'error' as const,
    }
  }

  const compilation = catalogValidators.get(entry.id)
  if (!compilation || !compilation.success) {
    return {
      code: 'INVALID_TOOL_SCHEMA',
      error: compilation?.error ?? 'Tool schema was not compiled.',
      id: entry.id,
      status: 'error' as const,
    }
  }

  return {
    ...getSchemaPayload(entry),
    status: 'success' as const,
  }
}

async function resolveNestedOutput(output: unknown): Promise<unknown> {
  if (typeof output !== 'object' || output === null || !(Symbol.asyncIterator in output)) {
    return output
  }

  let lastOutput: unknown
  for await (const nextOutput of output as AsyncIterable<unknown>) {
    lastOutput = nextOutput
  }
  return lastOutput
}

async function executeCatalogTool(
  entry: DynamicToolCatalogEntry,
  input: DynamicExecuteInput,
  options: Parameters<NonNullable<DynamicToolCatalogEntry['execute']>>[1],
) {
  if (!entry.execute) {
    return errorResult(
      `Tool "${entry.id}" is provider-managed and cannot be executed through execute_tool.`,
      jsonBody({
        id: entry.id,
        error: 'This tool does not expose a local execute handler.',
      }),
    )
  }

  try {
    const rawOutput = await entry.execute(input.args, {
      abortSignal: options.abortSignal,
      context: {},
      messages: options.messages,
      toolCallId: `${options.toolCallId}:${entry.id}`,
    })
    const normalizedResult = normalizeToolExecutionResult(entry.id, await resolveNestedOutput(rawOutput))
    return {
      ...normalizedResult,
      dynamicInvocation: createInvocationMetadata(entry.id, input.args),
    }
  } catch (error) {
    const summary =
      error instanceof Error && error.message.trim().length > 0 ? error.message : `Tool "${entry.id}" failed.`
    return errorResult(summary, undefined, {
      dynamicInvocation: createInvocationMetadata(entry.id, input.args),
    })
  }
}

export function getDynamicToolInvocationProjection(
  toolName: string,
  input: unknown,
  result?: unknown,
): DynamicToolInvocationMetadata | null {
  if (toolName !== DYNAMIC_EXECUTE_TOOL_NAME) {
    return null
  }

  if (isRecord(result) && isRecord(result.dynamicInvocation)) {
    const invocation = result.dynamicInvocation
    if (typeof invocation.toolName === 'string' && 'argumentsValue' in invocation) {
      return {
        argumentsValue: invocation.argumentsValue,
        toolName: invocation.toolName,
      }
    }
  }

  const parsedInput = parseDynamicExecuteInput(input)
  return parsedInput ? createInvocationMetadata(parsedInput.id.trim(), parsedInput.args) : null
}

export async function createDynamicToolSet(catalogEntries: readonly DynamicToolCatalogEntry[]): Promise<ToolSet> {
  const catalog = new Map(catalogEntries.map((entry) => [entry.id, entry]))
  const catalogValidators = new Map(
    catalogEntries.map((entry) => [entry.id, compileJsonSchema(entry.inputSchema)] as const),
  )
  const discoveredToolIds = new Set<string>()

  return {
    execute_tool: tool({
      description: 'Runs a catalog tool with a known id and arguments. Fetch its schema when the argument shape is not already known.',
      inputSchema: jsonSchema(DYNAMIC_EXECUTE_SCHEMA, {
        validate: validateDynamicExecuteInput,
      }),
      execute: async (rawInput, options) => {
        const input = parseDynamicExecuteInput(rawInput)
        if (!input) {
          return errorResult('Invalid execute_tool input.', jsonBody({ error: 'id and args are required.' }))
        }

        const entry = getCatalogEntry(catalog, input.id)
        if (!entry) {
          return getUnknownToolErrorResult(catalogEntries, input.id)
        }

        const compilation = catalogValidators.get(entry.id)
        if (!compilation || !compilation.success) {
          return errorResult(
            `Schema for tool "${entry.id}" is invalid.`,
            jsonBody({
              code: 'INVALID_TOOL_SCHEMA',
              error: compilation?.error ?? 'Tool schema was not compiled.',
              id: entry.id,
            }),
            {
              dynamicInvocation: createInvocationMetadata(entry.id, input.args),
            },
          )
        }

        const validationIssues = compilation.validator.validate(input.args)
        const validationError = getFirstValidationError(validationIssues)
        if (validationError) {
          const missingArguments = validationIssues
            .filter((issue) => issue.message === 'is required')
            .map((issue) => issue.path.replace(/^\$\./u, ''))
          const editRepair =
            entry.id === 'edit'
              ? {
                  changed: false,
                  nextStep:
                    'Read the file at args.path first, then retry edit with targetContent copied exactly from the latest read result. Do not guess the target text.',
                  retryable: true,
                }
              : {}
          return errorResult(
            `Invalid arguments for tool "${entry.id}".`,
            jsonBody({
              code: 'INVALID_ARGUMENTS',
              error: validationError,
              id: entry.id,
              ...(missingArguments.length > 0 ? { missing: missingArguments } : {}),
              ...editRepair,
              ...(entry.id === 'edit' ? {} : { schema: entry.inputSchema }),
            }),
            {
              dynamicInvocation: createInvocationMetadata(entry.id, input.args),
            },
          )
        }

        return executeCatalogTool(entry, input, options)
      },
    }),
    get_tool_schema: tool({
      description: `Gets the schema for one or more catalog tools. Use id for one tool or ids for up to ${DYNAMIC_SCHEMA_BATCH_SIZE} tools.`,
      inputSchema: jsonSchema(DYNAMIC_SCHEMA_SCHEMA, {
        validate: (value) => validateMetaInput(value, SCHEMA_INPUT_VALIDATOR),
      }),
      execute: async (rawInput) => {
        const input = parseDynamicSchemaInput(rawInput)
        if (!input) {
          return errorResult(
            'Invalid get_tool_schema input.',
            jsonBody({
              error: 'Provide either id as a string or ids as a non-empty array of catalog tool identifiers.',
              max_batch_size: DYNAMIC_SCHEMA_BATCH_SIZE,
            }),
          )
        }

        if (input.id !== undefined) {
          const schemaResult = getSchemaResult(
            catalog,
            catalogValidators,
            discoveredToolIds,
            input.id,
          )
          if (schemaResult.status === 'error') {
            return errorResult(schemaResult.error, jsonBody(schemaResult))
          }

          return successResult(`Fetched schema for ${schemaResult.id}`, jsonBody(schemaResult))
        }

        const results = input.ids.map((id) =>
          getSchemaResult(catalog, catalogValidators, discoveredToolIds, id),
        )
        const successfulCount = results.filter((result) => result.status === 'success').length
        const summary = `Fetched ${successfulCount} of ${input.ids.length} tool schemas`
        const body = jsonBody({ results })
        return successfulCount > 0 ? successResult(summary, body) : errorResult(summary, body)
      },
    }),
    list_tools: tool({
      description: 'Searches and lists tools in the catalog.',
      inputSchema: jsonSchema(DYNAMIC_LIST_SCHEMA, {
        validate: (value) => validateMetaInput(value, LIST_INPUT_VALIDATOR),
      }),
      execute: async (rawInput) => {
        const input = (rawInput ?? {}) as DynamicListInput
        const page = searchToolCatalog(catalogEntries, input.query, input.page)
        for (const result of page.results) {
          discoveredToolIds.add(result.id)
        }
        const summary = page.query ? `Searched ${page.query} in tool set` : 'Listed tool set'
        return successResult(summary, jsonBody(page), {
          semantics: {
            page: page.page,
            page_size: DYNAMIC_TOOL_PAGE_SIZE,
            query: page.query,
            total_matches: page.totalMatches,
          },
        })
      },
    }),
  }
}
