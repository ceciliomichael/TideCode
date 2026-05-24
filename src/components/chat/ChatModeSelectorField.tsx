import { Bot, Check } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFloatingMenuPosition } from '../../hooks/useFloatingMenuPosition'
import { Tooltip } from '../Tooltip'
import type { ChatMode } from '../../types/chat'

export interface ChatModeOption {
  description: string
  label: string
  value: ChatMode
}

interface ChatModeSelectorFieldProps {
  disabled?: boolean
  onChange: (value: ChatMode) => void
  options: readonly ChatModeOption[]
  value: ChatMode
}

export function ChatModeSelectorField({
  disabled = false,
  onChange,
  options,
  value,
}: ChatModeSelectorFieldProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedValue, setHighlightedValue] = useState<ChatMode>(value)
  const selectedOption = useMemo(() => options.find((option) => option.value === value) ?? options[0], [options, value])
  const menuStyle = useFloatingMenuPosition({
    anchorRef: buttonRef,
    isOpen,
    menuRef,
    preferredPlacement: 'above',
  })

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setHighlightedValue(value)
  }, [isOpen, value])

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
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [isOpen])

  function handleSelect(nextValue: ChatMode) {
    setIsOpen(false)
    if (nextValue !== value) {
      onChange(nextValue)
    }
  }

  function getGenericOptionTooltip(option: ChatModeOption) {
    if (option.value === 'agent') {
      return 'Interactive mode for direct coding help'
    }

    if (option.value === 'plan') {
      return 'Structured mode for planning before implementation'
    }

    return 'Choose how Echo should handle your request'
  }

  return (
    <div ref={containerRef} className="relative w-fit max-w-full">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        data-open={isOpen ? 'true' : 'false'}
        disabled={disabled}
        onClick={() => setIsOpen((currentValue) => !currentValue)}
        className="chat-runtime-control-trigger w-auto max-w-full disabled:cursor-not-allowed"
      >
        <Bot size={14} className="mr-1.5 shrink-0 text-current" style={{ transform: 'translateY(-0.1em)' }} />
        <span className="chat-runtime-control-label min-w-0 max-w-[12rem] truncate text-left">
          {selectedOption?.label ?? 'Select mode'}
        </span>
      </button>

      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              data-floating-menu-root="true"
              className="fixed z-40 w-[min(9rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-border bg-surface shadow-soft"
              style={menuStyle}
            >
              <div role="listbox" onMouseLeave={() => setHighlightedValue(value)} className="space-y-0.5 p-1.5">
                {options.map((option) => {
                  const isSelected = option.value === value
                  const isHighlighted = option.value === highlightedValue

                  return (
                    <Tooltip key={option.value} content={getGenericOptionTooltip(option)} side="right" fullWidthTrigger>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onMouseEnter={() => setHighlightedValue(option.value)}
                        onClick={() => handleSelect(option.value)}
                        className={[
                          'flex w-full items-start justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition-[background-color,color,box-shadow]',
                          isHighlighted
                            ? 'bg-[var(--dropdown-option-active-surface)] text-foreground shadow-sm'
                            : 'text-foreground hover:bg-[var(--dropdown-option-active-surface)]',
                        ].join(' ')}
                      >
                        <span className="block min-w-0 flex-1 truncate text-[15px] leading-5">{option.label}</span>
                        {isSelected ? <Check size={16} strokeWidth={2.2} className="mt-0.5 shrink-0 text-foreground" /> : null}
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
