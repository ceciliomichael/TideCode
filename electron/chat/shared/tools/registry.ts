import { asSchema, type ToolExecutionOptions, type ToolSet } from 'ai'
import type { JSONSchema7 } from '@ai-sdk/provider'
import Ajv, { type ValidateFunction } from 'ajv'
import Ajv2019 from 'ajv/dist/2019.js'
import Ajv2020 from 'ajv/dist/2020.js'
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

export interface AgentToolRegistry {
  entries: readonly AgentToolRegistryEntry[]
  get(name: string): AgentToolRegistryEntry | undefined
  search(query: string, namespace?: string, limit?: number): AgentToolSearchMatch[]
}

export function isDynamicAgentTool(entry: Pick<AgentToolRegistryEntry, 'namespace'>) {
  return entry.namespace === 'mcp'
}

function resolveToolNamespace(name: string): string {
  if (name.startsWith('mcp_')) return 'mcp'
  if (name.startsWith('terminal.')) return 'shell'
  if (name.startsWith('skill.')) return 'skills'
  if (name.startsWith('plan.')) return 'planning'
  return 'filesystem'
}

function scoreMatch(entry: AgentToolRegistryEntry, terms: string[]): number {
  const name = entry.name.toLowerCase()
  const namespace = entry.namespace.toLowerCase()
  const description = entry.description.toLowerCase()
  return terms.reduce((score, term) => score +
    (name === term ? 100 : name.includes(term) ? 50 : 0) +
    (namespace === term ? 30 : namespace.includes(term) ? 15 : 0) +
    (description.includes(term) ? 10 : 0), 0)
}

export async function createAgentToolRegistry(nativeTools: ToolSet): Promise<AgentToolRegistry> {
  const entries: AgentToolRegistryEntry[] = []
  const draft7Ajv = new Ajv({ allErrors: true, strict: false })
  const draft2019Ajv = new Ajv2019({ allErrors: true, strict: false })
  const draft2020Ajv = new Ajv2020({ allErrors: true, strict: false })

  function compileSchema(schema: JSONSchema7): ValidateFunction {
    const dialect = typeof schema.$schema === 'string' ? schema.$schema.toLowerCase() : ''
    if (dialect.includes('/draft/2020-12/schema')) return draft2020Ajv.compile(schema)
    if (dialect.includes('/draft/2019-09/schema')) return draft2019Ajv.compile(schema)
    return draft7Ajv.compile(schema)
  }

  for (const [name, definition] of Object.entries(nativeTools)) {
    if (typeof definition.execute !== 'function') throw new Error(`Native API ${name} is not executable.`)
    if (typeof definition.description !== 'string' || !definition.description.trim()) {
      throw new Error(`Missing native API documentation: ${name}`)
    }
    const namespace = resolveToolNamespace(name)
    const raw = (await asSchema(definition.inputSchema).jsonSchema) as JSONSchema7
    const inputSchema: JSONSchema7 = namespace === 'mcp' || raw.type !== 'object'
      ? raw : { ...raw, additionalProperties: false }
    const validate = compileSchema(inputSchema)
    const execute = definition.execute
    entries.push({
      description: definition.description.trim(),
      name,
      namespace,
      inputSchema,
      execute: async (input, options = {}) => {
        if (!validate(input)) {
          const details = (validate.errors ?? []).map((error) =>
            `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`).join('; ')
          return createToolErrorResult(`Invalid arguments for tools.${name}: ${details}`)
        }
        const toolOptions: ToolExecutionOptions<unknown> = {
          abortSignal: options.abortSignal,
          context: {},
          messages: [],
          toolCallId: options.toolCallId ?? `exec-${name}`,
        }
        const output = await execute(input, toolOptions)
        const normalized = normalizeToolExecutionResult(name, output)
        const bounded = await prepareToolExecutionResultForModel({ result: normalized, toolName: name })
        return normalized.body !== undefined && normalized.displayBody === undefined
          ? { ...bounded, displayBody: normalized.body } : bounded
      },
    })
  }

  const entryByName = new Map(entries.map((entry) => [entry.name, entry]))
  return {
    entries: Object.freeze(entries),
    get(name) { return entryByName.get(name) },
    search(query, namespace, limit = 10) {
      const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean)
      const filter = namespace?.trim().toLowerCase()
      return entries.map((entry) => ({
        description: entry.description,
        inputSchema: entry.inputSchema,
        name: entry.name,
        namespace: entry.namespace,
        score: scoreMatch(entry, terms) + (filter && entry.namespace === filter ? 1000 : 0),
      })).filter((entry) => (!filter || entry.namespace === filter) && (terms.length === 0 || entry.score > 0))
        .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
        .slice(0, Math.max(1, Math.min(20, Math.floor(limit))))
    },
  }
}
