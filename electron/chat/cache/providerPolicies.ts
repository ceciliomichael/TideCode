import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { ToolSet } from 'ai'
import type { ChatProviderId } from '../../../src/types/chat'
import { sha256, stableStringify } from './canonicalization'

const CACHE_KEY_SCHEMA = 'tidecode.prompt_cache/v2'
const ANTHROPIC_TOOL_CACHE_CONTROL = { ttl: '5m', type: 'ephemeral' } as const

export function derivePromptCacheKey(input: {
  cacheScopeId: string
  contextFingerprint: string
  modelId: string
  providerId: ChatProviderId
}) {
  return `ech_${sha256(stableStringify({
    cacheScopeId: input.cacheScopeId,
    contextFingerprint: input.contextFingerprint,
    modelId: input.modelId,
    providerId: input.providerId,
    schema: CACHE_KEY_SCHEMA,
  })).slice(0, 48)}`
}

export function resolvePromptCacheProviderOptions(input: {
  cacheKey: string
  providerId: ChatProviderId
}): ProviderOptions | undefined {
  if (input.providerId === 'openai' || input.providerId === 'codex') {
    return { openai: { promptCacheKey: input.cacheKey } }
  }

  if (input.providerId === 'anthropic') {
    return { anthropic: { cacheControl: { ttl: '5m', type: 'ephemeral' } } }
  }

  return undefined
}

export function resolvePromptCacheExtraBody(input: {
  cacheKey: string
  providerId: ChatProviderId
}) {
  return input.providerId === 'mistral' ? { prompt_cache_key: input.cacheKey } : {}
}

/**
 * Anthropic caches tool definitions only when a cache breakpoint is attached
 * to a tool. Keep the breakpoint on the lexicographically last tool so the
 * dynamic tool manifest remains deterministic across every request.
 *
 * Other providers deliberately pass through unchanged: they either use a
 * request-level cache key, have a different cache-resource lifecycle, or do
 * not define an equivalent tool-level cache control contract.
 */
export function applyPromptCacheBreakpoints(tools: ToolSet, providerId: ChatProviderId): ToolSet {
  if (providerId !== 'anthropic') {
    return tools
  }

  const lastToolName = Object.keys(tools).sort().at(-1)
  if (!lastToolName) {
    return tools
  }

  const lastTool = tools[lastToolName]
  const existingProviderOptions = 'providerOptions' in lastTool
    ? lastTool.providerOptions as ProviderOptions | undefined
    : undefined

  return {
    ...tools,
    [lastToolName]: {
      ...lastTool,
      providerOptions: mergeProviderOptions(
        existingProviderOptions,
        { anthropic: { cacheControl: ANTHROPIC_TOOL_CACHE_CONTROL } },
      ),
    },
  } as ToolSet
}

export function mergeProviderOptions(...values: Array<ProviderOptions | undefined>): ProviderOptions | undefined {
  const merged: ProviderOptions = {}
  for (const value of values) {
    if (!value) continue
    for (const [provider, options] of Object.entries(value)) {
      merged[provider] = {
        ...(merged[provider] ?? {}),
        ...options,
      }
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}
