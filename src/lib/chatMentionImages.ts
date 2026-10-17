import type { ChatImageAttachment } from '../types/chat'

export function findChatMentionImageAttachment(
  path: string,
  imageAttachments: readonly ChatImageAttachment[],
) {
  const attachmentPath = path.startsWith('tools.read:') ? path.slice('tools.read:'.length) : path
  return imageAttachments.find((attachment) => attachment.path === attachmentPath) ?? null
}
