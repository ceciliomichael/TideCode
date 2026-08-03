import { memo } from 'react'
import { splitChatMentionSegments } from '../../lib/chatMentions'
import { Tooltip } from '../Tooltip'

interface ChatMentionTextProps {
  className?: string
  mentionPathMap?: ReadonlyMap<string, string>
  text: string
  variant?: 'backdrop' | 'inline' | 'rendered'
  wrap?: 'wrap' | 'nowrap'
}

const mentionHighlightSurfaceClassName = 'rounded-[4px] bg-[rgba(59,130,246,0.18)]'
const folderHighlightSurfaceClassName = 'rounded-[4px] bg-[rgba(245,158,11,0.18)]'
const skillHighlightSurfaceClassName = 'rounded-[4px] bg-[rgba(168,85,247,0.18)]'

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

        const isSkill = Boolean(segment.path?.startsWith('load_skill:') || segment.path?.startsWith('skill:'))
        const isFolder = Boolean(segment.path?.startsWith('list:') || segment.path?.startsWith('folder:') || segment.path?.endsWith('/'))
        const isBackdrop = variant === 'backdrop'
        const isRendered = variant === 'rendered'
        const highlightClass = isSkill
          ? skillHighlightSurfaceClassName
          : isFolder
            ? folderHighlightSurfaceClassName
            : mentionHighlightSurfaceClassName

        const textColorClass = 'text-foreground font-normal'

        if (isRendered) {
          return (
            <Tooltip
              key={`mention-${index}`}
              content={segment.path ?? segment.label}
              triggerClassName="align-baseline"
              triggerLayout="inline"
            >
              <span className="relative inline align-baseline [overflow-wrap:anywhere]">
                <span className={`relative ${textColorClass}`}>
                  {segment.text}
                </span>
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-0 z-[1] ${highlightClass}`}
                />
              </span>
            </Tooltip>
          )
        }

        if (!isBackdrop) {
          return (
            <Tooltip
              key={`mention-${index}`}
              content={segment.path ?? segment.label}
              triggerClassName="align-baseline"
              triggerLayout="inline"
            >
              <span className="relative inline-block align-baseline [overflow-wrap:anywhere]">
                <span className={`relative ${textColorClass}`}>
                  {segment.text}
                </span>
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-0 z-[1] ${highlightClass}`}
                />
              </span>
            </Tooltip>
          )
        }

        return (
          <Tooltip
            key={`mention-${index}`}
            content={segment.path ?? segment.label}
            triggerClassName="align-baseline"
            triggerLayout="inline"
          >
            <span className={`${highlightClass} text-transparent`}>{segment.text}</span>
          </Tooltip>
        )
      })}
    </div>
  )
})
