import { asSchema, type ToolExecutionOptions, type ToolSet } from 'ai'
import type { JSONSchema7 } from '@ai-sdk/provider'
import Ajv, { type ValidateFunction } from 'ajv'
import type { AgentToolExecutionResult } from '../toolTypes'
import { normalizeToolExecutionResult } from '../toolReplay'
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
    normalizedName === 'write' ||
    normalizedName === 'edit' ||
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

function normalizeCodeModeInput(input: unknown, inputSchema: JSONSchema7, validateInput: ValidateFunction) {
  let normalizedInput = input
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const properties = inputSchema.properties
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
      const offsetSchema = properties.offset
      const record = input as Record<string, unknown>
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

    let inputSchema: JSONSchema7
    let validateInput: ValidateFunction
    try {
      inputSchema = await getToolInputSchema(tool)
      validateInput = ajv.compile(inputSchema)
    } catch (error) {
      console.warn(`Skipping ${name} from the Code Mode registry because its schema could not be resolved.`, error)
      continue
    }

    const execute = tool.execute
    entries.push({
      description: getToolDescription(tool, name),
      execute: async (input, options = {}) => {
        const normalizedInput = normalizeCodeModeInput(input, inputSchema, validateInput)
        if (!validateInput(normalizedInput)) {
          const validationDetails = (validateInput.errors ?? [])
            .map((validationError) => `${validationError.instancePath || '/'} ${validationError.message ?? 'is invalid'}`)
            .join('; ')
          return createToolErrorResult(`Invalid arguments for ${name}${validationDetails ? `: ${validationDetails}` : '.'}`)
        }

        const toolOptions: ToolExecutionOptions<unknown> = {
          abortSignal: options.abortSignal,
          context: {},
          messages: [],
          toolCallId: options.toolCallId ?? `code-mode-${name}`,
        }
        const output = await execute(normalizedInput, toolOptions)
        return normalizeToolExecutionResult(name, output)
      },
      inputSchema,
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
