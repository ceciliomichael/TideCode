import { createHash } from 'node:crypto'
import { asSchema } from '@ai-sdk/provider-utils'
import type { ToolSet } from 'ai'

function normalize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64')
  if (Array.isArray(value)) return value.map((item) => normalize(item, seen)).filter((item) => item !== undefined)
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[circular]'

  seen.add(value)
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    const normalized = normalize((value as Record<string, unknown>)[key], seen)
    if (normalized !== undefined) result[key] = normalized
  }
  seen.delete(value)
  return result
}

export function stableStringify(value: unknown) {
  return JSON.stringify(normalize(value, new WeakSet()))
}

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function describeTools(tools: ToolSet) {
  return Object.keys(tools).sort().map((name) => {
    const tool = tools[name]
    let inputSchema: unknown = null
    try {
      inputSchema = asSchema(tool.inputSchema).jsonSchema
    } catch {
      inputSchema = { unavailable: true }
    }
    return {
      description: 'description' in tool ? tool.description : undefined,
      inputSchema,
      name,
      providerOptions: tool.providerOptions,
      type: 'type' in tool ? tool.type : 'function',
    }
  })
}

export function buildPromptContextFingerprint(input: {
  modelId: string
  providerId: string
  system: string
  tools: ToolSet
}) {
  return buildPromptContextManifest(input).fingerprint
}

export function buildPromptContextManifest(input: {
  modelId: string
  providerId: string
  system: string
  tools: ToolSet
}) {
  const tools = stableStringify(describeTools(input.tools))
  const model = stableStringify({ modelId: input.modelId, providerId: input.providerId })
  const fingerprint = sha256(stableStringify({
    cacheSchema: 'tidecode.prompt_context/v1',
    model,
    system: input.system,
    tools,
  }))
  return {
    fingerprint,
    modelHash: sha256(model),
    systemHash: sha256(input.system),
    toolSchemaTokens: Math.ceil(tools.length / 4),
    toolsHash: sha256(tools),
  }
}
