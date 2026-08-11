import { X } from 'lucide-react'
import { resolveFileIconConfig } from '../../lib/fileIconResolver'
import { getChatAttachmentLabel } from '../../lib/chatAttachments'
import type { ChatTextAttachment } from '../../types/chat'

interface AttachmentPillProps {
  attachment: ChatTextAttachment
  onRemove?: () => void
}

export function AttachmentPill({ attachment, onRemove }: AttachmentPillProps) {
  const isRemovable = typeof onRemove === 'function'
  const attachmentLabel = getChatAttachmentLabel(attachment)
  const iconConfig = resolveFileIconConfig({
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
  })
  const Icon = iconConfig.icon
  const iconLabel = iconConfig.label

  if (!isRemovable) {
    return (
      <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-[var(--dropdown-control-surface)] px-3 py-1.5 text-sm text-muted-foreground">
        <Icon size={14} className="shrink-0" style={{ color: iconConfig.color }} aria-hidden="true" />
        <span className="min-w-0 truncate">{attachmentLabel}</span>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Detach ${attachmentLabel}`}
      className="group relative inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-[var(--dropdown-control-surface)] px-3 py-1.5 text-left text-sm text-muted-foreground transition-all duration-150 hover:border-[var(--dropdown-control-hover-border)] hover:bg-[var(--dropdown-control-hover-surface)] hover:text-foreground"
    >
      <span
        aria-hidden="true"
        className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface/80 text-muted-foreground"
      >
        <Icon
          size={13}
          className="transition-all duration-150 group-hover:scale-75 group-hover:opacity-0"
          style={{ color: iconConfig.color }}
        />
        <X size={13} className="absolute scale-75 opacity-0 transition-all duration-150 group-hover:scale-100 group-hover:opacity-100" />
      </span>
      <span className="min-w-0 truncate">{attachmentLabel}</span>
      <span className="sr-only">Click to detach</span>
      <span className="sr-only">{iconLabel}</span>
    </button>
  )
}
