import { ChevronDown, MessageSquare } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface WorkspacePlanActionsMenuProps {
  implementationDisabled: boolean
  isImplementationStarted: boolean
  implementationLabel: string
  onImplement: () => void
  onRequestChanges: () => void
  requestChangesDisabled: boolean
  requestChangesLabel: string
}

export function WorkspacePlanActionsMenu({
  implementationDisabled,
  isImplementationStarted,
  implementationLabel,
  onImplement,
  onRequestChanges,
  requestChangesDisabled,
  requestChangesLabel,
}: WorkspacePlanActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const actionControlHeightClass = 'h-8 min-h-8'

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setIsOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  useEffect(() => {
    if (implementationDisabled) {
      setIsOpen(false)
    }
  }, [implementationDisabled])

  const toggleMenu = () => setIsOpen((currentValue) => !currentValue)

  return (
    <div ref={containerRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        disabled={implementationDisabled}
        aria-label={implementationLabel}
        onClick={onImplement}
        className={[
          `inline-flex ${actionControlHeightClass} min-w-[142px] items-center justify-center px-3 text-xs font-medium transition-colors active:scale-[0.98]`,
          isImplementationStarted ? 'rounded-lg' : 'rounded-l-lg rounded-r-none',
          implementationDisabled ? 'chat-send-button-disabled cursor-not-allowed' : 'chat-send-button-enabled',
        ].join(' ')}
      >
        {implementationLabel}
      </button>
      {!isImplementationStarted ? (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-label="Open plan actions"
          onClick={toggleMenu}
          className={`chat-send-button-enabled inline-flex ${actionControlHeightClass} w-8 items-center justify-center rounded-l-none rounded-r-lg border-l border-white/15 text-xs transition active:scale-[0.98]`}
        >
          <ChevronDown size={13} className={isOpen ? 'rotate-180 transition-transform' : 'transition-transform'} aria-hidden="true" />
        </button>
      ) : null}

      {!isImplementationStarted && isOpen ? (
        <div
          role="menu"
          aria-label="Plan actions"
          className="absolute right-0 top-[calc(100%+6px)] z-[1200] min-w-[180px] overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-soft"
        >
          <button
            type="button"
            role="menuitem"
            disabled={requestChangesDisabled}
            onClick={() => {
              if (requestChangesDisabled) {
                return
              }

              setIsOpen(false)
              onRequestChanges()
            }}
            className={`flex ${actionControlHeightClass} w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <MessageSquare size={15} className="text-brand" aria-hidden="true" />
            {requestChangesLabel}
          </button>
        </div>
      ) : null}
    </div>
  )
}
