import { memo } from 'react'
import { splitChatMentionSegments } from '../../lib/chatMentions'

interface ChatMentionTextProps {
  className?: string
  mentionPathMap?: ReadonlyMap<string, string>
  text: string
  variant?: 'backdrop' | 'inline' | 'rendered'
  wrap?: 'wrap' | 'nowrap'
}

const mentionHighlightSurfaceClassName = 'rounded-[4px] bg-[rgba(59,130,246,0.18)]'
const mentionRenderedHighlightSurfaceClassName = 'rounded-[4px] bg-[rgba(59,130,246,0.14)]'

export const ChatMentionText = memo(function ChatMentionText({
  className,
  mentionPathMap,
  text,
  variant = 'inline',
  wrap = 'wrap',
}: ChatMentionTextProps) {
  const segments = splitChatMentionSegments(text, mentionPathMap)
  const rootClassName = [
    wrap === 'nowrap'
      ? 'block whitespace-nowrap overflow-hidden text-ellipsis [overflow-wrap:normal]'
      : variant === 'backdrop'
        ? 'whitespace-pre-wrap [overflow-wrap:break-word]'
        : 'whitespace-pre-wrap [overflow-wrap:anywhere]',
    variant === 'backdrop' ? 'text-transparent' : 'text-foreground',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  if (segments.length === 0) {
    return null
  }

  return (
    <div className={rootClassName}>
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          return (
            <span key={`text-${index}`} className={variant === 'backdrop' ? 'text-transparent' : undefined}>
              {segment.text}
            </span>
          )
        }

        const isBackdrop = variant === 'backdrop'
        const isRendered = variant === 'rendered'
        if (isRendered) {
          return (
            <span
              key={`mention-${index}`}
              className="relative inline align-baseline"
              title={segment.path ?? segment.label}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 ${mentionRenderedHighlightSurfaceClassName}`}
              />
              {segment.text}
            </span>
          )
        }

        if (!isBackdrop) {
          return (
            <span key={`mention-${index}`} className="relative inline-block" title={segment.path ?? segment.label}>
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 ${mentionHighlightSurfaceClassName}`}
              />
              <span className="relative z-[1] text-foreground">{segment.text}</span>
            </span>
          )
        }

        return (
          <span
            key={`mention-${index}`}
            className={`${mentionHighlightSurfaceClassName} text-transparent`}
            title={segment.path ?? segment.label}
          >
            {segment.text}
          </span>
        )
      })}
    </div>
  )
})
