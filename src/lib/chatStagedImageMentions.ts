import type { ChatAttachment, ChatImageAttachment } from '../types/chat'

const STAGED_IMAGE_PREFIX = '@attachments/.staged/'

/**
 * Composer-only mention identity. This is not a real attachment path and must
 * be replaced with a persisted @attachments/... alias before AI submission.
 */
export function getStagedChatImagePath(image: Pick<ChatImageAttachment, 'id'>) {
  return `${STAGED_IMAGE_PREFIX}${image.id}`
}

export function getChatAttachmentMentionPath(attachment: ChatAttachment) {
  if (attachment.kind === 'image') {
    return attachment.path || getStagedChatImagePath(attachment)
  }
  return attachment.kind === 'file' || attachment.kind === 'folder' ? attachment.path : null
}

export function hasStagedChatImageMention(
  attachments: readonly ChatAttachment[],
  mentionPathMap?: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
) {
  if (!mentionPathMap) return false
  const paths = mentionPathMap instanceof Map
    ? new Set(mentionPathMap.values())
    : new Set(Object.values(mentionPathMap))
  return attachments.some((attachment) =>
    attachment.kind === 'image' && !attachment.path && paths.has(getStagedChatImagePath(attachment)),
  )
}
