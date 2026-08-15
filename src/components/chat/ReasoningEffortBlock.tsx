import { useMemo } from 'react'
import { DropdownField } from '../ui/DropdownField'
import type { ReasoningEffort } from '../../types/chat'
import { getReasoningEffortPresentationOptions } from '../../lib/reasoningEffortPresentation'

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
  const reasoningEffortOptions = useMemo(
    () => getReasoningEffortPresentationOptions(options),
    [options],
  )

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
