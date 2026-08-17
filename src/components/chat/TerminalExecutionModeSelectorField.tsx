import { Check, ChevronDown, Shield, Terminal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AppTerminalExecutionMode } from '../../types/chat'
import { useFloatingMenuPosition } from '../../hooks/useFloatingMenuPosition'
import { Tooltip } from '../Tooltip'

interface TerminalExecutionModeOption {
  description: string
  icon: typeof Shield
  label: string
  value: AppTerminalExecutionMode
}

const TERMINAL_MODE_OPTIONS: readonly TerminalExecutionModeOption[] = [
  {
    description: 'Runs terminal commands through WSL sandbox mode.',
    icon: Shield,
    label: 'Sandbox',
    value: 'sandbox',
  },
  {
    description: 'Runs terminal commands directly on the host shell.',
    icon: Terminal,
    label: 'Full Access',
    value: 'full',
  },
] as const

interface TerminalExecutionModeSelectorFieldProps {
  onChange: (value: AppTerminalExecutionMode) => void
  triggerClassName?: string
  value: AppTerminalExecutionMode
}

export function TerminalExecutionModeSelectorField({
  onChange,
  triggerClassName,
  value,
}: TerminalExecutionModeSelectorFieldProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedValue, setHighlightedValue] = useState<AppTerminalExecutionMode>(value)
  const menuStyle = useFloatingMenuPosition({
    anchorRef: buttonRef,
    isOpen,
    menuRef,
  })
  const selectedOption = useMemo(
    () => TERMINAL_MODE_OPTIONS.find((option) => option.value === value) ?? TERMINAL_MODE_OPTIONS[0],
    [value],
  )
  const SelectedIcon = selectedOption.icon

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target
      if (
        target instanceof Node &&
        !containerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setHighlightedValue(value)
  }, [isOpen, value])

  return (
    <div ref={containerRef} className="relative min-w-0 w-full max-w-full">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        data-open={isOpen ? 'true' : 'false'}
        onClick={() => setIsOpen((currentValue) => !currentValue)}
        className={['chat-runtime-control-trigger min-w-0 w-full max-w-full', triggerClassName].filter(Boolean).join(' ')}
      >
        <SelectedIcon size={14} className="mr-1.5 shrink-0 text-current" />
        <span className="chat-runtime-control-label min-w-0 truncate text-left">{selectedOption.label}</span>
        <ChevronDown
          size={14}
          className={['ml-1.5 shrink-0 text-current transition-transform', isOpen ? 'rotate-180' : ''].join(' ')}
        />
      </button>

      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              data-floating-menu-root="true"
              role="listbox"
              aria-label="Terminal execution mode"
              className="fixed z-40 min-w-[14rem] overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-soft"
              style={menuStyle}
            >
              <div
                role="listbox"
                onMouseLeave={() => setHighlightedValue(value)}
                className="space-y-0.5"
              >
                {TERMINAL_MODE_OPTIONS.map((option) => {
                  const Icon = option.icon
                  const isSelected = option.value === value
                  const isHighlighted = option.value === highlightedValue

                  return (
                    <Tooltip key={option.value} content={option.description} side="right" fullWidthTrigger>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isHighlighted}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setHighlightedValue(option.value)}
                        onClick={() => {
                          onChange(option.value)
                          setIsOpen(false)
                        }}
                        className={[
                          'flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-[background-color,color,box-shadow] md:text-sm',
                          isHighlighted
                            ? 'bg-[var(--dropdown-option-active-surface)] text-foreground shadow-sm'
                            : 'text-foreground hover:bg-[var(--dropdown-option-active-surface)]',
                        ].join(' ')}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Icon size={14} className="shrink-0" />
                          <span className="truncate">{option.label}</span>
                        </span>
                        {isSelected ? <Check size={16} strokeWidth={2.2} className="shrink-0" /> : null}
                      </button>
                    </Tooltip>
                  )
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
