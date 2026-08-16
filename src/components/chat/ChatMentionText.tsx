import { memo } from 'react'
import { splitChatMentionSegments } from '../../lib/chatMentions'
import { splitChatImageReferenceSegments } from '../../lib/chatImageReferences'
import type { ChatImageAttachment } from '../../types/chat'
import { Tooltip } from '../Tooltip'
import { ChatImageReferenceLabel } from './ChatImageReferenceLabel'

interface ChatMentionTextProps {
  className?: string
  imageAttachments?: readonly ChatImageAttachment[]
  mentionPathMap?: ReadonlyMap<string, string>
  onImageReferenceHoverChange?: (isHovered: boolean) => void
  text: string
  variant?: 'backdrop' | 'inline' | 'rendered'
  wrap?: 'wrap' | 'nowrap'
}

const mentionHighlightSurfaceClassName = 'rounded-[4px] bg-[rgba(59,130,246,0.18)]'
const folderHighlightSurfaceClassName = 'rounded-[4px] bg-[rgba(245,158,11,0.18)]'
const skillHighlightSurfaceClassName = 'rounded-[4px] bg-[rgba(168,85,247,0.18)]'
const kanbanHighlightSurfaceClassName = 'rounded-[4px] bg-[rgba(34,197,94,0.2)]'

export const ChatMentionText = memo(function ChatMentionText({
  className,
  imageAttachments = [],
  mentionPathMap,
  onImageReferenceHoverChange,
  text,
  variant = 'inline',
  wrap = 'wrap',
}: ChatMentionTextProps) {
  const imageSegments = splitChatImageReferenceSegments(text, imageAttachments.length)
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

  if (imageSegments.some((segment) => segment.type === 'image')) {
    return (
      <span className={rootClassName}>
        {imageSegments.map((segment, index) => {
          if (segment.type === 'text') {
            return (
              <ChatMentionText
                key={`image-text-${index}`}
                mentionPathMap={mentionPathMap}
                text={segment.text}
                variant={variant}
              />
            )
          }

          const attachment = imageAttachments[segment.imageIndex]
          return attachment ? (
            <ChatImageReferenceLabel
              key={`image-${segment.imageNumber}-${index}`}
              attachment={attachment}
              label={segment.text}
              onHoverChange={onImageReferenceHoverChange}
              variant={variant}
            />
          ) : (
            <span key={`missing-image-${index}`}>{segment.text}</span>
          )
        })}
      </span>
    )
  }

  return (
    <span className={rootClassName}>
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          return (
            <span key={`text-${index}`} className={variant === 'backdrop' ? 'text-transparent' : undefined}>
              {segment.text}
            </span>
          )
        }

        const isSkill = Boolean(segment.path?.startsWith('load_skill:'))
        const isFolder = Boolean(segment.path?.startsWith('list:'))
        const isKanban = Boolean(segment.path?.startsWith('kanban:'))
        const isBackdrop = variant === 'backdrop'
        const isRendered = variant === 'rendered'
        const highlightClass = isSkill
          ? skillHighlightSurfaceClassName
          : isKanban
            ? kanbanHighlightSurfaceClassName
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
    </span>
  )
})
