import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { ChatProviderId } from '../../../src/types/chat'
import { sha256, stableStringify } from './canonicalization'

const CACHE_KEY_SCHEMA = 'echosphere.prompt_cache/v1'

export function derivePromptCacheKey(input: {
  contextFingerprint: string
  conversationId: string | null
  modelId: string
  providerId: ChatProviderId
}) {
  return `ech_${sha256(stableStringify({
    contextFingerprint: input.contextFingerprint,
    conversationId: input.conversationId ?? 'ephemeral',
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
