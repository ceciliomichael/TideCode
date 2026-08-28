import { useMemo } from 'react'
import { DropdownField } from '../ui/DropdownField'
import type { ReasoningEffort } from '../../types/chat'
import { getReasoningEffortPresentationOptions } from '../../lib/reasoningEffortPresentation'

interface ReasoningEffortBlockProps {
  disabled?: boolean
  fullWidth?: boolean
  onChange: (effort: ReasoningEffort) => void
  options: readonly ReasoningEffort[]
  triggerClassName?: string
  value: ReasoningEffort
}

export function ReasoningEffortBlock({
  disabled = false,
  fullWidth = false,
  onChange,
  options,
  triggerClassName,
  value,
}: ReasoningEffortBlockProps) {
  const reasoningEffortOptions = useMemo(
    () => getReasoningEffortPresentationOptions(options),
    [options],
  )

  return (
    <section aria-label="Reasoning effort" className={fullWidth ? 'flex w-full items-center' : 'flex items-center'}>
      <DropdownField
        ariaLabel="Reasoning effort"
        className={fullWidth ? 'w-full' : 'w-fit max-w-full'}
        fitToContent={!fullWidth}
        variant="text"
        selectedOptionIconClassName="text-foreground"
        triggerClassName={fullWidth ? ['w-full', triggerClassName].filter(Boolean).join(' ') : triggerClassName}
        value={value}
        onChange={(nextValue) => onChange(nextValue as ReasoningEffort)}
        options={reasoningEffortOptions}
        disabled={disabled}
      />
    </section>
  )
}
