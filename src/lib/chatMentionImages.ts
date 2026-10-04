import type { ChatImageAttachment } from '../types/chat'

export function findChatMentionImageAttachment(
  path: string,
  imageAttachments: readonly ChatImageAttachment[],
) {
  return imageAttachments.find((attachment) => attachment.path === path) ?? null
}
