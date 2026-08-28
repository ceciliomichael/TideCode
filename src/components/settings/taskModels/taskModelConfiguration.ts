import type { ChatProviderId, ReasoningEffort } from '../../../types/chat'
import { getReasoningEffortPresentationOptions } from '../../../lib/reasoningEffortPresentation'
import { resolveReasoningEffortTransition } from '../../../lib/reasoningEffortTransition'

interface TaskModelConfigurationSummaryInput {
  defaultReasoningEffort?: ReasoningEffort
  modelId: string
  modelLabel: string
  providerId: ChatProviderId | null
  providerLabel?: string | null
  reasoningEffort: ReasoningEffort
  reasoningEfforts?: readonly ReasoningEffort[]
}

export function getTaskModelConfigurationSummary({
  defaultReasoningEffort,
  modelId,
  modelLabel,
  providerId,
  providerLabel,
  reasoningEffort,
  reasoningEfforts,
}: TaskModelConfigurationSummaryInput): string {
  const normalizedModelId = modelId.trim()
  if (!normalizedModelId || providerId === null) return 'Use chat input model'

  const parts: string[] = []
  if (providerLabel?.trim()) parts.push(providerLabel.trim())
  parts.push(modelLabel.trim() || normalizedModelId)

  if (reasoningEfforts?.length) {
    const normalizedEffort = resolveReasoningEffortTransition({
      currentEffort: reasoningEffort,
      defaultEffort: defaultReasoningEffort,
      supportedEfforts: reasoningEfforts,
    })
    const effortLabel = getReasoningEffortPresentationOptions(reasoningEfforts)
      .find((option) => option.value === normalizedEffort)?.label ?? normalizedEffort
    parts.push(effortLabel)
  }

  return parts.join(' · ')
}
