import type { ChatTextAttachment } from '../../types/chat'
import { AttachmentPill } from './AttachmentPill'

interface AttachmentPillListProps {
  attachments: readonly ChatTextAttachment[]
  onRemoveAttachment?: (attachmentId: string) => void
}

export function AttachmentPillList({ attachments, onRemoveAttachment }: AttachmentPillListProps) {
  if (attachments.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {attachments.map((attachment) => (
        <AttachmentPill
          key={attachment.id}
          attachment={attachment}
          onRemove={onRemoveAttachment ? () => onRemoveAttachment(attachment.id) : undefined}
        />
      ))}
    </div>
  )
}
