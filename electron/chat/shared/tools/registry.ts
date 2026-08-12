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
    normalizedName === 'list' ||
    normalizedName === 'read_tool_output'
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

function normalizeCodeModeInput(input: unknown, inputSchema: JSONSchema7) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input

  const properties = inputSchema.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return input

  const offsetSchema = properties.offset
  if (!offsetSchema || typeof offsetSchema !== 'object' || Array.isArray(offsetSchema)) return input

  const record = input as Record<string, unknown>
  if (offsetSchema.minimum !== 1 || record.offset !== 0) return input

  // Code Mode models often use zero-based offsets. The concrete read APIs are
  // intentionally one-based, so map the harmless first-line spelling here.
  return { ...record, offset: 1 }
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
        const normalizedInput = normalizeCodeModeInput(input, inputSchema)
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
