import { Check, ChevronDown } from 'lucide-react'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { twMerge } from 'tailwind-merge'
import { useFloatingMenuPosition } from '../../hooks/useFloatingMenuPosition'

export interface DropdownOption {
  label: string
  value: string
}

interface DropdownFieldProps {
  ariaLabel?: string
  className?: string
  disabled?: boolean
  fitToContent?: boolean
  flushOptions?: boolean
  id?: string
  onChange: (value: string) => void
  options: readonly DropdownOption[]
  triggerClassName?: string
  value: string
  variant?: 'default' | 'text'
}

const OPTION_HEIGHT_PX = 36
const VIRTUAL_OVERSCAN_OPTION_COUNT = 6
const VIRTUALIZATION_THRESHOLD = 200

export function DropdownField({
  ariaLabel,
  className,
  disabled = false,
  fitToContent = false,
  flushOptions = false,
  id,
  onChange,
  options,
  triggerClassName,
  value,
  variant = 'default',
}: DropdownFieldProps) {
  const generatedId = useId()
  const controlId = id ?? generatedId
  const listboxId = `${controlId}-listbox`
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const listboxRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [listboxScrollTop, setListboxScrollTop] = useState(0)
  const [listboxViewportHeight, setListboxViewportHeight] = useState(0)
  const [highlightedIndex, setHighlightedIndex] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  )
  const menuStyle = useFloatingMenuPosition({
    anchorRef: buttonRef,
    isOpen,
    menuRef: listboxRef,
  })
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? options[0],
    [options, value],
  )
  const shouldVirtualizeOptions = options.length > VIRTUALIZATION_THRESHOLD
  const estimatedVisibleOptionCount = Math.max(1, Math.ceil(listboxViewportHeight / OPTION_HEIGHT_PX))
  const virtualStartIndex = Math.max(0, Math.floor(listboxScrollTop / OPTION_HEIGHT_PX) - VIRTUAL_OVERSCAN_OPTION_COUNT)
  const virtualEndIndex = Math.min(
    options.length,
    virtualStartIndex + estimatedVisibleOptionCount + VIRTUAL_OVERSCAN_OPTION_COUNT * 2,
  )
  const virtualOptions = options.slice(virtualStartIndex, virtualEndIndex)
  const virtualTopOffset = virtualStartIndex * OPTION_HEIGHT_PX
  const virtualTotalHeight = options.length * OPTION_HEIGHT_PX

  useEffect(() => {
    const selectedIndex = options.findIndex((option) => option.value === value)
    if (selectedIndex >= 0) {
      setHighlightedIndex(selectedIndex)
    }
  }, [options, value])

  useEffect(() => {
    if (!isOpen) {
      setListboxScrollTop(0)
      setListboxViewportHeight(0)
      return
    }

    const selectedIndex = options.findIndex((option) => option.value === value)
    if (selectedIndex >= 0) {
      setHighlightedIndex(selectedIndex)
    }
  }, [isOpen, options, value])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target
      if (
        target instanceof Node &&
        !containerRef.current?.contains(target) &&
        !listboxRef.current?.contains(target)
      ) {
        setIsOpen(false)
      }
    }

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
        buttonRef.current?.focus()
      }
    }

    function handleWindowScroll(event: Event) {
      const target = event.target
      if (
        target instanceof Node &&
        !containerRef.current?.contains(target) &&
        !listboxRef.current?.contains(target)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    window.addEventListener('scroll', handleWindowScroll, true)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
      window.removeEventListener('scroll', handleWindowScroll, true)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    listboxRef.current?.focus()
    const listboxElement = listboxRef.current
    if (!listboxElement) {
      return
    }

    setListboxViewportHeight(listboxElement.clientHeight)
    setListboxScrollTop(listboxElement.scrollTop)

    if (shouldVirtualizeOptions) {
      const optionTop = highlightedIndex * OPTION_HEIGHT_PX
      const optionBottom = optionTop + OPTION_HEIGHT_PX
      const visibleTop = listboxElement.scrollTop
      const visibleBottom = visibleTop + listboxElement.clientHeight
      if (optionTop < visibleTop) {
        listboxElement.scrollTop = optionTop
      } else if (optionBottom > visibleBottom) {
        listboxElement.scrollTop = optionBottom - listboxElement.clientHeight
      }
      return
    }

    const activeOption = listboxElement.querySelector<HTMLElement>(`[data-option-index="${highlightedIndex}"]`)
    activeOption?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex, isOpen, shouldVirtualizeOptions])

  function commitValue(nextValue: string) {
    setIsOpen(false)
    if (nextValue !== value) {
      onChange(nextValue)
    }
    buttonRef.current?.focus()
  }

  function resetHighlightToSelected() {
    const selectedIndex = options.findIndex((option) => option.value === value)
    if (selectedIndex >= 0) {
      setHighlightedIndex(selectedIndex)
    }
  }

  function handleButtonKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (disabled) {
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const selectedIndex = Math.max(
        0,
        options.findIndex((option) => option.value === value),
      )
      setHighlightedIndex(selectedIndex)
      setIsOpen(true)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setIsOpen((currentValue) => !currentValue)
    }
  }

  function handleListboxKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex((currentValue) => Math.min(currentValue + 1, options.length - 1))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((currentValue) => Math.max(currentValue - 1, 0))
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      setHighlightedIndex(0)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      setHighlightedIndex(options.length - 1)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const highlightedOption = options[highlightedIndex]
      if (highlightedOption) {
        commitValue(highlightedOption.value)
      }
    }
  }

  return (
    <div ref={containerRef} className={['relative', className].filter(Boolean).join(' ')}>
      <button
        id={controlId}
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setIsOpen((currentValue) => !currentValue)}
        onKeyDown={handleButtonKeyDown}
        data-open={isOpen ? 'true' : 'false'}
        className={twMerge(
          variant === 'text'
            ? 'chat-runtime-control-trigger justify-start disabled:cursor-not-allowed'
            : [
                'flex h-9 items-center justify-between rounded-xl border bg-surface px-3 text-[13px] font-normal text-foreground transition-[background-color,border-color,color] hover:bg-[var(--dropdown-control-hover-surface)] hover:border-[var(--dropdown-control-hover-border)] disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-muted disabled:text-muted-foreground md:text-sm',
                isOpen
                  ? 'border-[var(--dropdown-control-open-border)] bg-[var(--dropdown-control-open-surface)]'
                  : 'border-border',
              ].join(' '),
          variant === 'text' || fitToContent ? 'w-auto max-w-full' : 'w-full',
          triggerClassName,
        )}
      >
        <span
          className={[
            'text-left',
            variant === 'text' ? 'chat-runtime-control-label' : '',
            variant === 'text' || fitToContent ? '' : 'truncate pr-3',
          ].join(' ')}
        >
          {selectedOption?.label ?? ''}
        </span>
        {variant === 'default' ? (
          <ChevronDown
            size={16}
            strokeWidth={2.2}
            className={['shrink-0 text-muted-foreground transition-transform', isOpen ? 'rotate-180' : ''].join(' ')}
          />
        ) : null}
      </button>

      {isOpen
        ? createPortal(
            <div
              ref={listboxRef}
              id={listboxId}
              data-floating-menu-root="true"
              role="listbox"
              tabIndex={-1}
              aria-labelledby={controlId}
              onKeyDown={handleListboxKeyDown}
              onMouseLeave={resetHighlightToSelected}
              onScroll={(event) => {
                setListboxScrollTop(event.currentTarget.scrollTop)
                setListboxViewportHeight(event.currentTarget.clientHeight)
              }}
              className={[
                'fixed z-[1500] overflow-y-auto rounded-xl border border-border bg-surface shadow-soft',
                flushOptions ? 'p-0' : fitToContent ? 'p-0.5' : 'p-1',
              ].join(' ')}
              style={menuStyle}
            >
              {shouldVirtualizeOptions ? (
                <div style={{ height: `${virtualTotalHeight}px`, position: 'relative' }}>
                  <div style={{ transform: `translateY(${virtualTopOffset}px)` }}>
                    {virtualOptions.map((option, index) => {
                      const optionIndex = virtualStartIndex + index
                      const isSelected = option.value === value
                      const isHighlighted = optionIndex === highlightedIndex

                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          data-option-index={optionIndex}
                          onMouseEnter={() => setHighlightedIndex(optionIndex)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => commitValue(option.value)}
                          className={[
                            'flex h-9 w-full items-center justify-between px-3 text-left text-[13px] transition-[background-color,color,box-shadow] md:text-sm',
                            flushOptions ? 'rounded-none' : 'rounded-lg',
                            isHighlighted
                              ? 'bg-[var(--dropdown-option-active-surface)] text-foreground shadow-sm'
                              : 'text-foreground hover:bg-[var(--dropdown-option-active-surface)]',
                          ].join(' ')}
                        >
                          <span className="truncate pr-3">{option.label}</span>
                          {isSelected ? <Check size={16} strokeWidth={2.2} className="shrink-0 text-foreground" /> : null}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                options.map((option, index) => {
                  const isSelected = option.value === value
                  const isHighlighted = index === highlightedIndex

                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-option-index={index}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => commitValue(option.value)}
                      className={[
                        'flex h-9 w-full items-center justify-between px-3 text-left text-[13px] transition-[background-color,color,box-shadow] md:text-sm',
                        flushOptions ? 'rounded-none' : 'rounded-lg',
                        isHighlighted
                          ? 'bg-[var(--dropdown-option-active-surface)] text-foreground shadow-sm'
                          : 'text-foreground hover:bg-[var(--dropdown-option-active-surface)]',
                      ].join(' ')}
                    >
                      <span className="truncate pr-3">{option.label}</span>
                      {isSelected ? <Check size={16} strokeWidth={2.2} className="shrink-0 text-foreground" /> : null}
                    </button>
                  )
                })
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
