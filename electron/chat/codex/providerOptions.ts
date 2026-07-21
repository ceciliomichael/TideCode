import type { ReasoningEffort } from '../../../src/types/chat'

export function buildCodexProviderOptions(input: {
  cacheKey?: string
  reasoningEffort: ReasoningEffort
  system?: string
}) {
  return {
    openai: {
      forceReasoning: true,
      instructions: input.system,
      ...(input.cacheKey ? { promptCacheKey: input.cacheKey } : {}),
      reasoningEffort: input.reasoningEffort,
      reasoningSummary: 'auto',
      store: false,
    },
  } as const
}
