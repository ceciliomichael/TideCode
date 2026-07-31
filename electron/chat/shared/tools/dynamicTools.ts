import { jsonSchema, tool, type ToolSet } from 'ai'
import { normalizeToolExecutionResult } from '../toolReplay'
import type { AgentToolExecutionResult } from '../toolTypes'
import {
  DYNAMIC_EXECUTE_TOOL_NAME,
  DYNAMIC_TOOL_PAGE_SIZE,
  isRecord,
  type DynamicExecuteInput,
  type DynamicListInput,
  type DynamicSchemaInput,
  type DynamicToolCatalogEntry,
  type DynamicToolInvocationMetadata,
} from './dynamicToolContracts'
import { getFirstValidationError, validateJsonSchema } from './dynamicToolValidation'
import { searchToolCatalog } from './dynamicToolSearch'

const DYNAMIC_LIST_SCHEMA = {
  additionalProperties: false,
  properties: {
    page: { description: '1-indexed result page.', minimum: 1, type: 'integer' },
    query: { description: 'Natural-language text describing the capability to find.', type: 'string' },
  },
  type: 'object',
}

const DYNAMIC_SCHEMA_SCHEMA = {
  additionalProperties: false,
  properties: {
    id: { description: 'Catalog tool identifier.', minLength: 1, type: 'string' },
  },
  required: ['id'],
  type: 'object',
}

const DYNAMIC_EXECUTE_SCHEMA = {
  additionalProperties: false,
  properties: {
    args: { description: 'Arguments for the selected catalog tool.', type: 'object' },
    id: { description: 'Catalog tool identifier.', minLength: 1, type: 'string' },
  },
  required: ['id', 'args'],
  type: 'object',
}

function validateMetaInput(value: unknown, schema: Record<string, unknown>) {
  const message = getFirstValidationError(validateJsonSchema(value, schema))
  return message ? { error: new Error(`Invalid dynamic tool input: ${message}`), success: false as const } : { success: true as const, value }
}

function getCatalogEntry(catalog: ReadonlyMap<string, DynamicToolCatalogEntry>, id: string) {
  const normalizedId = id.trim()
  return normalizedId.length > 0 ? catalog.get(normalizedId) ?? null : null
}

function jsonBody(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function successResult(summary: string, body: string, extra: Partial<AgentToolExecutionResult> = {}): AgentToolExecutionResult {
  return {
    ...extra,
    body,
    status: 'success',
    summary,
  }
}

function errorResult(summary: string, body?: string, extra: Partial<AgentToolExecutionResult> = {}): AgentToolExecutionResult {
  return {
    ...extra,
    ...(body ? { body } : {}),
    status: 'error',
    summary,
  }
}

function parseDynamicExecuteInput(value: unknown): DynamicExecuteInput | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !isRecord(value.args)) {
    return null
  }
  return { args: value.args, id: value.id }
}

function createInvocationMetadata(toolName: string, argumentsValue: unknown): DynamicToolInvocationMetadata {
  return { argumentsValue, toolName }
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
      jsonBody({ id: entry.id, error: 'This tool does not expose a local execute handler.' }),
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
    const summary = error instanceof Error && error.message.trim().length > 0
      ? error.message
      : `Tool "${entry.id}" failed.`
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

  return {
    execute_tool: tool({
      description: 'Runs a tool from the catalog.',
      inputSchema: jsonSchema(DYNAMIC_EXECUTE_SCHEMA, {
        validate: (value) => validateMetaInput(value, DYNAMIC_EXECUTE_SCHEMA),
      }),
      execute: async (rawInput, options) => {
        const input = parseDynamicExecuteInput(rawInput)
        if (!input) {
          return errorResult('Invalid execute_tool input.', jsonBody({ error: 'id and args are required.' }))
        }

        const entry = getCatalogEntry(catalog, input.id)
        if (!entry) {
          return errorResult(
            `Tool "${input.id}" not found or not allowed.`,
            jsonBody({ error: `Tool "${input.id}" not found or not allowed.` }),
          )
        }

        const validationError = getFirstValidationError(validateJsonSchema(input.args, entry.inputSchema))
        if (validationError) {
          return errorResult(
            `Invalid arguments for tool "${entry.id}".`,
            jsonBody({ error: validationError, id: entry.id, schema: entry.inputSchema }),
            { dynamicInvocation: createInvocationMetadata(entry.id, input.args) },
          )
        }

        return executeCatalogTool(entry, input, options)
      },
    }),
    get_tool_schema: tool({
      description: 'Gets the schema for a catalog tool.',
      inputSchema: jsonSchema(DYNAMIC_SCHEMA_SCHEMA, {
        validate: (value) => validateMetaInput(value, DYNAMIC_SCHEMA_SCHEMA),
      }),
      execute: async (rawInput) => {
        const input = rawInput as DynamicSchemaInput
        const entry = getCatalogEntry(catalog, input.id)
        if (!entry) {
          return errorResult(`Tool "${input.id}" not found or not allowed.`, jsonBody({ error: `Tool "${input.id}" not found or not allowed.` }))
        }

        return successResult(
          `Fetched schema for ${entry.id}`,
          jsonBody({
            description: entry.description,
            guidance: {
              safety: [...entry.guidance.safety],
              whenToUse: entry.guidance.whenToUse,
              workflow: [...entry.guidance.workflow],
            },
            id: entry.id,
            name: entry.name,
            parameters: entry.inputSchema,
            tags: entry.tags,
          }),
        )
      },
    }),
    list_tools: tool({
      description: 'Searches and lists tools in the catalog.',
      inputSchema: jsonSchema(DYNAMIC_LIST_SCHEMA, {
        validate: (value) => validateMetaInput(value, DYNAMIC_LIST_SCHEMA),
      }),
      execute: async (rawInput) => {
        const input = (rawInput ?? {}) as DynamicListInput
        const page = searchToolCatalog(catalogEntries, input.query, input.page)
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
