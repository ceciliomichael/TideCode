import type { ReasoningEffort } from '../types/chat'

export const REASONING_EFFORT_VALUES: readonly ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
export const DEFAULT_REASONING_EFFORT_VALUES: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh']
export const OPENAI_COMPATIBLE_REASONING_EFFORT_VALUES: readonly ReasoningEffort[] = ['low', 'medium', 'high']
export const ANTHROPIC_REASONING_EFFORT_VALUES: readonly ReasoningEffort[] = ['low', 'medium', 'high']
export const GOOGLE_REASONING_EFFORT_VALUES: readonly ReasoningEffort[] = ['minimal', 'low', 'medium', 'high']
export const GOOGLE_PRO_REASONING_EFFORT_VALUES: readonly ReasoningEffort[] = ['low', 'medium', 'high']

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && REASONING_EFFORT_VALUES.includes(value as ReasoningEffort)
}

export function normalizeReasoningEffort(
  value: ReasoningEffort,
  supportedEfforts: readonly ReasoningEffort[],
): ReasoningEffort {
  if (supportedEfforts.length === 0 || supportedEfforts.includes(value)) {
    return value
  }

  return supportedEfforts.includes('medium') ? 'medium' : supportedEfforts[0]
}
