import type { ReasoningEffort } from '../types/chat'
import { orderReasoningEfforts } from './reasoningEffortOrder'

const REASONING_EFFORT_LABELS: Readonly<Record<string, string>> = {
  high: 'High',
  low: 'Low',
  max: 'Maximum',
  minimal: 'Minimal',
  medium: 'Medium',
  none: 'None',
  xhigh: 'XHigh',
}

const DEEPSEEK_EFFORT_LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  high: 'Low',
  max: 'High',
}

const TOGGLE_EFFORT_LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  none: 'Disable',
  high: 'Enabled',
}

function getEffortLabelOverrides(options: readonly ReasoningEffort[]) {
  const isDeepSeekPair = options.length === 2 && options.includes('high') && options.includes('max')
  const isDeepSeekWithNone =
    options.length === 3 && options.includes('none') && options.includes('high') && options.includes('max')

  if (isDeepSeekPair || isDeepSeekWithNone) return DEEPSEEK_EFFORT_LABEL_OVERRIDES
  if (options.length === 2 && options.includes('none') && options.includes('high')) {
    return TOGGLE_EFFORT_LABEL_OVERRIDES
  }
  return null
}

export interface ReasoningEffortPresentationOption {
  label: string
  value: ReasoningEffort
}

export function getReasoningEffortPresentationOptions(
  options: readonly ReasoningEffort[],
): ReasoningEffortPresentationOption[] {
  const orderedOptions = orderReasoningEfforts(options)
  const labelOverrides = getEffortLabelOverrides(orderedOptions)
  return orderedOptions.map((option) => ({
    label: labelOverrides?.[option] ?? REASONING_EFFORT_LABELS[option] ?? option,
    value: option,
  }))
}
