import { useMemo } from 'react'
import { DropdownField } from '../ui/DropdownField'
import type { ReasoningEffort } from '../../types/chat'
import { orderReasoningEfforts } from '../../lib/reasoningEffortOrder'

const REASONING_EFFORT_LABELS: Readonly<Record<string, string>> = {
  high: 'High',
  low: 'Low',
  max: 'Maximum',
  minimal: 'Minimal',
  medium: 'Medium',
  none: 'None',
  xhigh: 'XHigh',
}

// Legacy DeepSeek profiles expose ['high', 'max'] (and optionally 'none' to
// disable thinking); show them as Low / High instead of High / Maximum.
// New DeepSeek profiles use native none/low/medium/high labels already.
const DEEPSEEK_EFFORT_LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  high: 'Low',
  max: 'High',
}

// Mistral models expose a ['none', 'high'] toggle; show it as Disable / Enabled instead of None / High.
const TOGGLE_EFFORT_LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  none: 'Disable',
  high: 'Enabled',
}

function getEffortLabelOverrides(options: readonly ReasoningEffort[]) {
  const isDeepSeekPair =
    options.length === 2 && options.includes('high') && options.includes('max')
  const isDeepSeekWithNone =
    options.length === 3 && options.includes('none') && options.includes('high') && options.includes('max')
  if (isDeepSeekPair || isDeepSeekWithNone) {
    return DEEPSEEK_EFFORT_LABEL_OVERRIDES
  }
  if (options.length === 2 && options.includes('none') && options.includes('high')) {
    return TOGGLE_EFFORT_LABEL_OVERRIDES
  }
  return null
}

interface ReasoningEffortBlockProps {
  disabled?: boolean
  onChange: (effort: ReasoningEffort) => void
  options: readonly ReasoningEffort[]
  value: ReasoningEffort
}

export function ReasoningEffortBlock({
  disabled = false,
  onChange,
  options,
  value,
}: ReasoningEffortBlockProps) {
  const reasoningEffortOptions = useMemo(() => {
    const orderedOptions = orderReasoningEfforts(options)
    const labelOverrides = getEffortLabelOverrides(orderedOptions)
    return orderedOptions.map((option) => ({
      label: labelOverrides?.[option] ?? REASONING_EFFORT_LABELS[option] ?? option,
      value: option,
    }))
  }, [options])

  return (
    <section aria-label="Reasoning effort" className="flex items-center">
      <DropdownField
        ariaLabel="Reasoning effort"
        className="w-fit max-w-full"
        fitToContent
        variant="text"
        selectedOptionIconClassName="text-foreground"
        value={value}
        onChange={(nextValue) => onChange(nextValue as ReasoningEffort)}
        options={reasoningEffortOptions}
        disabled={disabled}
      />
    </section>
  )
}
