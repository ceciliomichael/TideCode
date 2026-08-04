import { Search, RefreshCw, Check } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFloatingMenuPosition } from '../../hooks/useFloatingMenuPosition'

export interface ModelSelectorOption {
  label: string
  providerLabel: string
  value: string
}

interface ModelSelectorFieldProps {
  className?: string
  disabled?: boolean
  fullWidth?: boolean
  isLoading?: boolean
  onChange: (value: string) => void
  options: readonly ModelSelectorOption[]
  size?: 'default' | 'comfortable'
  value: string
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase()
}

export function ModelSelectorField({
  className,
  disabled = false,
  fullWidth = false,
  isLoading = false,
  onChange,
  options,
  size = 'default',
  value,
}: ModelSelectorFieldProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [highlightedValue, setHighlightedValue] = useState(value)
  const normalizedSearch = normalizeSearch(searchValue)
  const menuStyle = useFloatingMenuPosition({
    anchorRef: buttonRef,
    isOpen,
    menuRef,
  })
  const selectedOption = useMemo(() => options.find((option) => option.value === value) ?? options[0], [options, value])
  const filteredOptions = useMemo(() => {
    if (normalizedSearch.length === 0) {
      return options
    }

    return options.filter((option) => option.label.toLowerCase().includes(normalizedSearch))
  }, [normalizedSearch, options])
  const isControlDisabled = disabled

  useEffect(() => {
    if (isOpen && isControlDisabled) {
      setIsOpen(false)
    }
  }, [isControlDisabled, isOpen])

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

    searchInputRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setHighlightedValue(value)
  }, [isOpen, value])

  function handleSelect(nextValue: string) {
    setIsOpen(false)
    if (nextValue !== value) {
      onChange(nextValue)
    }
  }

  const triggerSizeClassName =
    size === 'comfortable' ? 'min-h-12 rounded-xl px-4 py-2.5 text-[15px]' : ''
  const menuWidthClassName =
    size === 'comfortable'
      ? 'w-[min(20rem,calc(100vw-1rem))] min-w-[12rem]'
      : 'w-[min(18rem,calc(100vw-1rem))] min-w-[10rem]'
  const searchInputClassName = size === 'comfortable' ? 'h-10 rounded-lg text-[14px]' : 'h-9 rounded-lg text-sm'
  const actionButtonClassName = size === 'comfortable' ? 'h-10 w-10 rounded-lg' : 'h-9 w-9 rounded-lg'

  return (
    <div ref={containerRef} className={['relative max-w-full', className ?? 'w-fit'].join(' ')}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-busy={isLoading || undefined}
        data-open={isOpen ? 'true' : 'false'}
        disabled={isControlDisabled}
        onClick={() => {
          if (isControlDisabled) {
            return
          }

          setIsOpen((currentValue) => !currentValue)
        }}
        className={[
          'chat-runtime-control-trigger max-w-full disabled:cursor-not-allowed hover:bg-[var(--dropdown-control-hover-surface)] hover:border-[var(--dropdown-control-hover-border)] hover:text-foreground',
          fullWidth ? 'w-full' : 'w-auto',
          triggerSizeClassName,
        ].join(' ')}
      >
        {isLoading ? (
          <span className="flex min-w-0 max-w-[18rem] items-center gap-2 text-left">
            <span aria-hidden="true" className="h-3 w-14 shrink-0 rounded-full bg-border opacity-80 animate-pulse" />
            <span className="chat-runtime-control-label min-w-0 truncate text-subtle-foreground">Loading models...</span>
          </span>
        ) : (
          <span className="chat-runtime-control-label min-w-0 max-w-[18rem] truncate text-left">
            {selectedOption?.label ?? 'No models available'}
          </span>
        )}
      </button>

      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              data-floating-menu-root="true"
              className={[
                'fixed z-[60] overflow-hidden rounded-xl border border-border bg-surface shadow-soft',
                menuWidthClassName,
              ].join(' ')}
              style={menuStyle}
            >
              <div className="flex items-center gap-1.5 border-b border-border px-2 py-2">
                <div className="relative min-w-0 flex-1 pr-1">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchValue}
                    onChange={(event) => setSearchValue(event.target.value)}
                    placeholder="Search models..."
                    className={[
                      'w-full border border-border bg-surface-muted pl-8 pr-2.5 text-foreground outline-none placeholder:text-subtle-foreground',
                      searchInputClassName,
                    ].join(' ')}
                  />
                </div>
                <button
                  type="button"
                  aria-label="Refresh model list"
                  onClick={() => setSearchValue('')}
                  className={[
                    'flex items-center justify-center border border-border bg-surface-muted text-muted-foreground transition-colors hover:text-foreground',
                    actionButtonClassName,
                  ].join(' ')}
                >
                  <RefreshCw size={14} />
                </button>
              </div>

              <div
                role="listbox"
                onMouseLeave={() => setHighlightedValue(value)}
                className="max-h-56 space-y-0.5 overflow-y-auto p-1"
              >
                {filteredOptions.length > 0 ? (
                  filteredOptions.map((option) => {
                    const isSelected = option.value === value
                    const isHighlighted = option.value === highlightedValue

                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onMouseEnter={() => setHighlightedValue(option.value)}
                        onClick={() => handleSelect(option.value)}
                        className={[
                          'flex w-full items-start justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-[background-color,color,box-shadow]',
                          isHighlighted
                            ? 'bg-[var(--dropdown-option-active-surface)] text-foreground shadow-sm'
                            : 'text-foreground hover:bg-[var(--dropdown-option-active-surface)]',
                        ].join(' ')}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] leading-5">{option.label}</span>
                          <span className="mt-0.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {option.providerLabel}
                          </span>
                        </span>
                        {isSelected ? <Check size={16} strokeWidth={2.2} className="mt-0.5 shrink-0 text-foreground" /> : null}
                      </button>
                    )
                  })
                ) : (
                  <p className="px-2.5 py-2 text-sm text-muted-foreground">No models found.</p>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
