import type { ChatImageAttachment } from '../../types/chat'

interface ChatMentionImageHoverContentProps {
  attachment: ChatImageAttachment
}

export function ChatMentionImageHoverContent({
  attachment,
}: ChatMentionImageHoverContentProps) {
  return (
    <img
      src={attachment.dataUrl}
      alt={attachment.fileName}
      className="block h-auto w-auto max-h-[min(20rem,calc(100vh-3rem))] max-w-[min(24rem,calc(100vw-3rem))] rounded-md object-contain"
    />
  )
}
