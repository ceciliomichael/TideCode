import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock, Gauge } from 'lucide-react'
import type { CodexUsageSnapshot } from '../../types/chat'
import { Tooltip } from '../Tooltip'
import { buildCodexUsageSummaryItems, formatCodexUsageResetCountdown } from './codexUsage'

interface CodexUsageIndicatorProps {
  disabled?: boolean
  usage: CodexUsageSnapshot | null
}

export function CodexUsageIndicator({ disabled = false, usage }: CodexUsageIndicatorProps) {
  const items = useMemo(() => buildCodexUsageSummaryItems(usage), [usage])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [tooltipPosition, setTooltipPosition] = useState<'above' | 'below'>('above')

  function calculatePosition() {
    const buttonRect = buttonRef.current?.getBoundingClientRect()
    if (!buttonRect) {
      return 'above' as const
    }

    return buttonRect.top < 260 ? 'below' as const : 'above' as const
  }

  function togglePopover() {
    if (disabled) {
      return
    }

    setIsOpen((currentValue) => {
      if (currentValue) {
        return false
      }

      setTooltipPosition(calculatePosition())
      return true
    })
  }

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (
        target instanceof Node &&
        !containerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setIsOpen(false)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  if (items.length === 0) {
    return null
  }

  const primaryItem = items[0]

  const hoverSummary = items.map((item) => `${item.label} ${item.remainingPercent}%`).join(', ')

  return (
    <div ref={containerRef} className="relative w-fit max-w-full">
      <Tooltip content={hoverSummary} side="top" hideWhenTriggerExpanded>
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={isOpen}
          aria-label={`Codex usage ${hoverSummary}`}
        className="inline-flex h-8 w-auto max-w-full items-center bg-transparent px-0 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:cursor-not-allowed disabled:text-disabled-foreground"
        disabled={disabled}
        onClick={togglePopover}
        data-open={isOpen ? 'true' : 'false'}
      >
          {primaryItem?.remainingPercent !== undefined ? (
            <Gauge size={14} className="mr-1.5 shrink-0 text-current" />
          ) : null}
          <span className="min-w-0 max-w-[8rem] truncate text-left">Usage</span>
        </button>
      </Tooltip>

      {isOpen ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Codex usage details"
          className={[
            'absolute right-0 z-50 w-60 rounded-2xl border border-border bg-surface p-3 text-xs text-foreground shadow-soft',
            tooltipPosition === 'above' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          ].join(' ')}
          style={{ zIndex: 60 }}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-foreground">Codex usage</span>
            <span className="inline-flex min-h-5 items-center justify-center rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium leading-none text-accent-foreground">
              Live
            </span>
          </div>

          <div className="mt-3 space-y-2">
            {items.map((item) => (
              <div
                key={`${item.windowKind}-${item.label}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-muted/35 px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Clock size={12} className="shrink-0 text-subtle-foreground" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">
                      {item.label}
                    </div>
                    <div className="text-[12px] text-foreground">Resets in {formatCodexUsageResetCountdown(item.resetAfterSeconds)}</div>
                  </div>
                </div>
                <span className="inline-flex min-h-5 shrink-0 items-center justify-center rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium leading-none text-foreground">
                  {item.remainingPercent}%
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
