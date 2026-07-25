import { useCallback, useLayoutEffect, useMemo, useRef, type CSSProperties, type ClipboardEvent, type ChangeEvent, type KeyboardEvent, type MouseEvent, type RefObject } from 'react'
import { ChatMentionText } from './ChatMentionText'

interface ChatMentionTextareaProps {
  className?: string
  disabled?: boolean
  mentionPathMap?: ReadonlyMap<string, string>
  onBlur?: () => void
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  onFocus?: () => void
  onInput?: () => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void
  onClick?: (event: MouseEvent<HTMLTextAreaElement>) => void
  onSelect?: () => void
  placeholder?: string
  rows?: number
  style?: CSSProperties
  textareaRef: RefObject<HTMLTextAreaElement>
  value: string
}

const MAX_TEXTAREA_HEIGHT_PX = 200

export function ChatMentionTextarea({
  className,
  disabled = false,
  mentionPathMap,
  onBlur,
  onChange,
  onFocus,
  onInput,
  onKeyDown,
  onPaste,
  onClick,
  onSelect,
  placeholder,
  rows = 1,
  style,
  textareaRef,
  value,
}: ChatMentionTextareaProps) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const backdropContentRef = useRef<HTMLDivElement>(null)
  const textareaStyle = useMemo(
    () =>
      ({
        ...style,
        caretColor: 'var(--color-foreground)',
        overflowWrap: 'break-word',
        whiteSpace: 'pre-wrap',
      }) as CSSProperties,
    [style],
  )

  const textareaClassName = useMemo(
    () =>
      [
        'min-h-[28px] max-h-[200px] w-full resize-none border-none bg-transparent text-[15px] leading-6 text-foreground outline-none placeholder:text-subtle-foreground focus:outline-none focus:ring-0',
        className,
      ]
        .filter(Boolean)
        .join(' '),
    [className],
  )

  const sharedLayerClassName = useMemo(
    () =>
      [
        'min-h-[28px] max-h-[200px] w-full text-[15px] leading-6',
        className,
      ]
        .filter(Boolean)
        .join(' '),
    [className],
  )

  const syncBackdropScroll = useCallback(() => {
    const textarea = textareaRef.current
    const backdropContent = backdropContentRef.current
    if (!textarea || !backdropContent) {
      return
    }

    backdropContent.style.transform = `translate3d(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px, 0)`
  }, [textareaRef])

  const syncBackdropLayout = useCallback(() => {
    const textarea = textareaRef.current
    const backdrop = backdropRef.current
    const backdropContent = backdropContentRef.current
    if (!textarea || !backdrop || !backdropContent) {
      return
    }

    textarea.style.height = 'auto'
    const nextHeight = Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)
    const nextHeightStyle = `${nextHeight}px`
    textarea.style.height = nextHeightStyle
    backdrop.style.height = nextHeightStyle
    backdropContent.style.width = `${textarea.clientWidth}px`
    syncBackdropScroll()
  }, [syncBackdropScroll, textareaRef])

  useLayoutEffect(() => {
    syncBackdropLayout()
    const frameId = window.requestAnimationFrame(syncBackdropLayout)
    return () => window.cancelAnimationFrame(frameId)
  }, [syncBackdropLayout, value])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea || typeof ResizeObserver !== 'function') {
      return
    }

    let frameId: number | null = null
    const resizeObserver =
      new ResizeObserver(() => {
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId)
        }
        frameId = window.requestAnimationFrame(() => {
          frameId = null
          syncBackdropLayout()
        })
      })

    resizeObserver.observe(textarea)

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
      resizeObserver.disconnect()
    }
  }, [syncBackdropLayout, textareaRef])

  function handleScroll() {
    syncBackdropScroll()
  }

  function handleInput() {
    onInput?.()
    syncBackdropScroll()
    window.requestAnimationFrame(syncBackdropLayout)
  }

  return (
    <div className="relative w-full">
      <div ref={backdropRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          ref={backdropContentRef}
          className={sharedLayerClassName}
          style={{
            ...style,
            overflowWrap: 'break-word',
            whiteSpace: 'pre-wrap',
            willChange: 'transform',
          }}
        >
          <ChatMentionText text={value} mentionPathMap={mentionPathMap} variant="backdrop" />
        </div>
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onBlur={onBlur}
        onChange={onChange}
        onFocus={onFocus}
        onInput={handleInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onClick={onClick}
        onScroll={handleScroll}
        onSelect={onSelect}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        spellCheck={false}
        className={textareaClassName}
        style={textareaStyle}
      />
    </div>
  )
}
