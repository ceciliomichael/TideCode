import type { ReasoningEffort } from '../../src/types/chat'
import { getReasoningEffortPresentationOptions } from '../../src/lib/reasoningEffortPresentation'
import type { SystemModelItem } from './models'
import type { SelectItem } from './interactiveSelect'

export function buildTerminalReasoningEffortItems(
  model: SystemModelItem,
  currentEffort: ReasoningEffort,
): SelectItem<ReasoningEffort>[] {
  if (!model.reasoningCapable || !model.reasoningEfforts?.length) return []

  return getReasoningEffortPresentationOptions(model.reasoningEfforts).map((option) => ({
    value: option.value,
    label: option.label,
    description: option.value === currentEffort
      ? 'Current reasoning effort'
      : `${model.label} reasoning effort`,
    isCurrent: option.value === currentEffort,
  }))
}
