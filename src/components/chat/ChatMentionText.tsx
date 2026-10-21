import { memo, type ReactNode } from 'react'
import { splitChatImageReferenceSegments } from '../../lib/chatImageReferences'
import {
  findChatMentionImageAttachment,
  getChatMentionImagePreview,
} from '../../lib/chatMentionImages'
import { getChatMentionTooltipTarget, splitChatMentionSegments } from '../../lib/chatMentions'
import { chatMentionTooltipPanelClassName } from '../../lib/chatStyles'
import type { ChatImageAttachment } from '../../types/chat'
import { Tooltip } from '../Tooltip'
import { ToolImageResult } from './ToolImageResult'
import { ChatMentionImageHoverContent } from './ChatMentionImageHoverContent'
import { ChatImageReferenceLabel } from './ChatImageReferenceLabel'

interface ChatMentionTextProps {
  className?: string
  conversationId?: string | null
  imageAttachments?: readonly ChatImageAttachment[]
  mentionPathMap?: ReadonlyMap<string, string>
  onImageReferenceHoverChange?: (isHovered: boolean) => void
  text: string
  workspaceRootPath?: string | null
  variant?: 'backdrop' | 'inline' | 'rendered'
  wrap?: 'wrap' | 'nowrap'
}

const mentionHighlightSurfaceClassName = 'rounded-[4px] bg-info-surface'
const folderHighlightSurfaceClassName = 'rounded-[4px] bg-warning-surface'
const skillHighlightSurfaceClassName = 'rounded-[4px] bg-brand-soft'
const mcpHighlightSurfaceClassName = 'rounded-[4px] bg-mcp-surface'

export const ChatMentionText = memo(function ChatMentionText({
  className,
  conversationId,
  imageAttachments = [],
  mentionPathMap,
  onImageReferenceHoverChange,
  text,
  workspaceRootPath,
  variant = 'inline',
  wrap = 'wrap',
}: ChatMentionTextProps) {
  const referenceImageAttachments = imageAttachments.filter((attachment) => !attachment.path)
  const imageSegments = splitChatImageReferenceSegments(text, referenceImageAttachments.length)
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
                conversationId={conversationId}
                imageAttachments={imageAttachments}
                mentionPathMap={mentionPathMap}
                onImageReferenceHoverChange={onImageReferenceHoverChange}
                text={segment.text}
                workspaceRootPath={workspaceRootPath}
                variant={variant}
              />
            )
          }

          const attachment = referenceImageAttachments[segment.imageIndex]
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

        const isSkill = Boolean(
          segment.path?.startsWith('tools.skill.load:') ||
          segment.path?.startsWith('load_skill:') ||
          segment.path?.startsWith('@skills/'),
        )
        const isMcp = Boolean(segment.path?.startsWith('tools.available.search:'))
        const isFolder = Boolean(
          segment.path?.startsWith('tools.list:') ||
          segment.path?.startsWith('list:') ||
          segment.path?.endsWith('/'),
        )
        const isBackdrop = variant === 'backdrop'
        const isRendered = variant === 'rendered'
        const imageAttachment = segment.path
          ? findChatMentionImageAttachment(segment.path, imageAttachments)
          : null
        const imagePreview = segment.path
          ? getChatMentionImagePreview(segment.path, workspaceRootPath)
          : null
        let tooltipContent: ReactNode = getChatMentionTooltipTarget(segment.path ?? segment.label ?? '')
        if (imageAttachment) {
          tooltipContent = <ChatMentionImageHoverContent attachment={imageAttachment} />
        } else if (imagePreview) {
          tooltipContent = (
            <ToolImageResult
              conversationId={conversationId}
              presentation={imagePreview.presentation}
              workspaceRootPath={imagePreview.workspaceRootPath}
            />
          )
        }
        const isImageMention = imageAttachment !== null || imagePreview !== null
        const tooltipPanelClassName = isImageMention
          ? '!max-w-[min(26rem,calc(100vw-24px))] !items-stretch !p-2'
          : chatMentionTooltipPanelClassName
        let highlightClass = mentionHighlightSurfaceClassName
        if (isMcp) {
          highlightClass = mcpHighlightSurfaceClassName
        } else if (isSkill) {
          highlightClass = skillHighlightSurfaceClassName
        } else if (isFolder) {
          highlightClass = folderHighlightSurfaceClassName
        }

        const textColorClass = 'text-foreground font-normal'

        if (isRendered) {
          return (
            <Tooltip
              key={`mention-${index}`}
              content={tooltipContent}
              panelClassName={tooltipPanelClassName}
              triggerClassName="align-baseline"
              triggerLayout="inline"
            >
              <span className="relative inline align-baseline [overflow-wrap:anywhere]">
                <span className={`relative z-[2] ${textColorClass}`}>
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
              content={tooltipContent}
              panelClassName={tooltipPanelClassName}
              triggerClassName="align-baseline"
              triggerLayout="inline"
            >
              <span className="relative inline-block align-baseline [overflow-wrap:anywhere]">
                <span className={`relative z-[2] ${textColorClass}`}>
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
          <span
            key={`mention-${index}`}
            data-chat-mention-path={segment.path ?? segment.label}
            className={`${highlightClass} text-transparent`}
          >
            {segment.text}
          </span>
        )
      })}
    </span>
  )
})
