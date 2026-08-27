import type { ReasoningEffort } from '../../../src/types/chat'
import { resolveSystemPromptTransportProviderOptions } from '../shared/providerPromptTransport'

export function buildCodexProviderOptions(input: {
  cacheKey?: string
  reasoningEffort: ReasoningEffort
  system?: string
}) {
  const promptTransport = resolveSystemPromptTransportProviderOptions('codex', input.system)?.openai
  return {
    openai: {
      forceReasoning: true,
      ...(promptTransport ?? {}),
      ...(input.cacheKey ? { promptCacheKey: input.cacheKey } : {}),
      reasoningEffort: input.reasoningEffort,
      reasoningSummary: 'auto',
      store: false,
    },
  } as const
}
