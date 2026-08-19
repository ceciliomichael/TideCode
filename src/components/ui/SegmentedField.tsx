import { GitCompareArrows } from 'lucide-react'
import { Tooltip } from '../Tooltip'

export interface SegmentedFieldOption {
  label: string
  value: string
}

interface SegmentedFieldProps {
  ariaLabel?: string
  className?: string
  disabled?: boolean
  onChange: (value: string) => void
  options: readonly SegmentedFieldOption[]
  value: string
}

interface DiffPanelSegmentedToggleProps {
  disabled?: boolean
  isOpen: boolean
  onToggle: () => void
  totalAddedLineCount: number
  totalRemovedLineCount: number
}

export function SegmentedField({
  ariaLabel,
  className,
  disabled = false,
  onChange,
  options,
  value,
}: SegmentedFieldProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={[
'inline-flex w-full gap-1 rounded-xl border border-border bg-background p-1 shadow-[var(--shadow-control-inset)] md:w-auto',
        disabled ? 'opacity-70' : '',
        className ?? '',
      ].join(' ')}
    >
      {options.map((option) => {
        const isActive = option.value === value

        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={[
'min-w-0 flex-1 rounded-lg px-3 py-1.5 text-[13px] font-normal transition-colors md:min-w-[56px] md:flex-none md:text-sm',
              isActive
                ? 'bg-[var(--segmented-control-active-surface)] text-foreground shadow-sm'
                : 'bg-transparent text-muted-foreground hover:bg-[var(--segmented-control-hover-surface)] hover:text-foreground',
            ].join(' ')}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function DiffPanelSegmentedToggle({
  disabled = false,
  isOpen,
  onToggle,
  totalAddedLineCount,
  totalRemovedLineCount,
}: DiffPanelSegmentedToggleProps) {
  const tooltipLabel = disabled ? 'Open a git-backed folder to view diffs' : isOpen ? 'Hide diff panel' : 'Show diff panel'

  return (
    <Tooltip content={tooltipLabel} side="bottom">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={isOpen}
        onClick={onToggle}
        className={[
          'inline-flex h-10 items-center gap-1.5 text-sm text-muted-foreground transition-colors',
          disabled ? 'cursor-not-allowed opacity-60' : 'hover:text-foreground',
        ].join(' ')}
      >
        <GitCompareArrows size={16} className="shrink-0" />
        {disabled ? null : (
          <>
            <span className="text-emerald-600 dark:text-emerald-400">{`+${totalAddedLineCount}`}</span>
            <span className="text-red-600 dark:text-red-400">{`-${totalRemovedLineCount}`}</span>
          </>
        )}
      </button>
    </Tooltip>
  )
}
