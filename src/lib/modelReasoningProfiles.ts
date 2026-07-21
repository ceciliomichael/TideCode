import type { ReasoningEffort } from '../types/chat'

export interface ModelReasoningProfile {
  defaultEffort: ReasoningEffort
  efforts: readonly ReasoningEffort[]
}

export interface DeclaredModelReasoning {
  defaultReasoningEffort?: ReasoningEffort
  reasoningCapable?: boolean
  reasoningEfforts?: readonly ReasoningEffort[]
}

export function resolveModelReasoningProfile(
  model: DeclaredModelReasoning,
): ModelReasoningProfile | null {
  if (!model.reasoningCapable || !model.reasoningEfforts?.length) return null

  const efforts = Array.from(new Set(model.reasoningEfforts))
  const defaultEffort = model.defaultReasoningEffort && efforts.includes(model.defaultReasoningEffort)
    ? model.defaultReasoningEffort
    : efforts.includes('medium')
      ? 'medium'
      : efforts[0]

  return { defaultEffort, efforts }
}
