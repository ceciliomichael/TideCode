import { useMemo } from 'react'
import { DropdownField } from '../ui/DropdownField'
import type { ReasoningEffort } from '../../types/chat'

const REASONING_EFFORT_LABELS: Readonly<Record<string, string>> = {
  high: 'High',
  low: 'Low',
  max: 'Maximum',
  minimal: 'Minimal',
  medium: 'Medium',
  none: 'None',
  xhigh: 'XHigh',
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
    return options.map((option) => ({
      label: REASONING_EFFORT_LABELS[option] ?? option,
      value: option,
    }))
  }, [options])

  return (
    <section aria-label="Reasoning effort" className="flex items-center">
      <DropdownField
        ariaLabel="Reasoning effort"
        className="w-fit max-w-full"
        fitToContent
        flushOptions
        variant="text"
        value={value}
        onChange={(nextValue) => onChange(nextValue as ReasoningEffort)}
        options={reasoningEffortOptions}
        disabled={disabled}
      />
    </section>
  )
}
