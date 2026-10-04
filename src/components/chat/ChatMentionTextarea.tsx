import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ClipboardEvent, type ChangeEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type RefObject } from 'react'
import { ChatMentionText } from './ChatMentionText'
import { findChatMentionImageAttachment } from '../../lib/chatMentionImages'
import type { ChatImageAttachment } from '../../types/chat'
import { AnchoredTooltip, type AnchoredTooltipRect } from '../Tooltip'
import { ChatMentionImageHoverContent } from './ChatMentionImageHoverContent'

interface ChatMentionTextareaProps {
  className?: string
  disabled?: boolean
  imageAttachments?: readonly ChatImageAttachment[]
  mentionPathMap?: ReadonlyMap<string, string>
  onBeforeInput?: (event: FormEvent<HTMLTextAreaElement>) => void
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
  textareaRef: RefObject<HTMLTextAreaElement | null>
  value: string
}

const MAX_TEXTAREA_HEIGHT_PX = 200

export function ChatMentionTextarea({
  className,
  disabled = false,
  imageAttachments = [],
  mentionPathMap,
  onBeforeInput,
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
  const [hoveredMention, setHoveredMention] = useState<{
    path: string
    rect: AnchoredTooltipRect
  } | null>(null)
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

  function handleMouseMove(event: MouseEvent<HTMLDivElement>) {
    const backdropContent = backdropContentRef.current
    if (!backdropContent) {
      setHoveredMention(null)
      return
    }

    const mentionElements = backdropContent.querySelectorAll<HTMLElement>('[data-chat-mention-path]')
    for (const mentionElement of mentionElements) {
      const rect = mentionElement.getBoundingClientRect()
      if (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      ) {
        const path = mentionElement.dataset.chatMentionPath
        if (path) {
          setHoveredMention({
            path,
            rect: {
              bottom: rect.bottom,
              height: rect.height,
              left: rect.left,
              right: rect.right,
              top: rect.top,
              width: rect.width,
            },
          })
          return
        }
      }
    }
    setHoveredMention(null)
  }

  const hoveredImageAttachment = hoveredMention
    ? findChatMentionImageAttachment(hoveredMention.path, imageAttachments)
    : null

  return (
    <div
      className="relative w-full"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoveredMention(null)}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onBeforeInput={onBeforeInput}
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

      <div ref={backdropRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-[1] overflow-hidden">
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
          <ChatMentionText
            imageAttachments={imageAttachments}
            text={value}
            mentionPathMap={mentionPathMap}
            variant="backdrop"
          />
        </div>
      <AnchoredTooltip
        anchorElement={null}
        anchorRect={hoveredMention?.rect ?? null}
        content={hoveredImageAttachment && hoveredMention
          ? <ChatMentionImageHoverContent attachment={hoveredImageAttachment} />
          : hoveredMention?.path ?? ''}
        panelClassName={hoveredImageAttachment
          ? '!max-w-[min(26rem,calc(100vw-24px))] !items-stretch !p-2'
          : undefined}
        visible={hoveredMention !== null}
      />
      </div>
    </div>
  )
}
