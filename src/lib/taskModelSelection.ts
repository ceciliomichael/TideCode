import type { ChatProviderId, ReasoningEffort } from '../types/chat'
import { resolveReasoningEffortTransition } from './reasoningEffortTransition'

interface TaskModelOption {
  id: string
  defaultReasoningEffort?: ReasoningEffort
  providerId: ChatProviderId | null
  providerLabel: string
  reasoningEfforts?: readonly ReasoningEffort[]
  runtimeModelId: string
}

interface DefaultTaskModelSelection {
  hasConfiguredProvider: boolean
  modelId: string
  providerId: ChatProviderId | null
  providerLabel: string | null
  reasoningEffort: ReasoningEffort
}

interface ResolveTaskModelSelectionInput {
  defaultSelection: DefaultTaskModelSelection
  modelOptions: readonly TaskModelOption[]
  taskModelId: string
  taskModelProviderId: ChatProviderId | null
  taskReasoningEffort: ReasoningEffort
}

export function resolveTaskModelSelection(input: ResolveTaskModelSelectionInput): DefaultTaskModelSelection {
  const normalizedTaskModelId = input.taskModelId.trim()
  if (normalizedTaskModelId.length === 0) {
    return input.defaultSelection
  }

  const matchingOption =
    input.taskModelProviderId !== null
      ? input.modelOptions.find(
          (option) => option.id === normalizedTaskModelId && option.providerId === input.taskModelProviderId,
        ) ?? null
      : input.modelOptions.find((option) => option.id === normalizedTaskModelId) ?? null

  if (!matchingOption || !matchingOption.providerId) {
    return input.defaultSelection
  }

  return {
    hasConfiguredProvider: true,
    modelId: matchingOption.runtimeModelId,
    providerId: matchingOption.providerId,
    providerLabel: matchingOption.providerLabel,
    reasoningEffort: resolveReasoningEffortTransition({
      currentEffort: input.taskReasoningEffort,
      defaultEffort: matchingOption.defaultReasoningEffort,
      supportedEfforts: matchingOption.reasoningEfforts,
    }),
  }
}
