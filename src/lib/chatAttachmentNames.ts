import type { ChatAttachment } from '../types/chat'

/** Uses the same basename, sanitization, and suffix policy as saved attachments. */
export function sanitizeChatAttachmentFileName(fileName: string) {
  const basename = fileName.trim().split(/[\\/]/u).at(-1) ?? ''
  const safeName = basename.replace(/[<>:"/\\|?*\p{Cc}]/gu, '_')
  return safeName || 'attachment'
}

export async function resolveUniqueChatAttachmentFileName(
  requestedName: string,
  isDirectory: boolean,
  isOccupied: (candidate: string) => boolean | Promise<boolean>,
) {
  const safeName = sanitizeChatAttachmentFileName(requestedName)
  const lastDot = isDirectory ? -1 : safeName.lastIndexOf('.')
  const extension = lastDot > 0 ? safeName.slice(lastDot) : ''
  const stem = extension ? safeName.slice(0, -extension.length) : safeName
  let candidateName = safeName
  let suffix = 2
  while (await isOccupied(candidateName)) {
    candidateName = `${stem} (${suffix})${extension}`
    suffix += 1
  }
  return candidateName
}

/** Computes the draft mention labels without writing to the attachments folder. */
export async function nameStagedChatImages(
  conversationId: string | null | undefined,
  existingAttachments: readonly ChatAttachment[],
  newAttachments: readonly ChatAttachment[],
): Promise<ChatAttachment[]> {
  if (!newAttachments.some((attachment) => attachment.kind === 'image' && !attachment.path)) {
    return [...newAttachments]
  }
  const stored = await window.tidecodeHistory.listChatAttachments(conversationId ?? '')
  const occupiedNames = new Set(stored.map((attachment) => attachment.fileName.toLowerCase()))
  for (const attachment of existingAttachments) {
    if (attachment.kind === 'image' && !attachment.path) {
      occupiedNames.add(attachment.fileName.toLowerCase())
    }
  }

  const result: ChatAttachment[] = []
  for (const attachment of newAttachments) {
    if (attachment.kind !== 'image' || attachment.path) {
      result.push(attachment)
      continue
    }
    const fileName = await resolveUniqueChatAttachmentFileName(
      attachment.fileName,
      false,
      (candidate) => occupiedNames.has(candidate.toLowerCase()),
    )
    occupiedNames.add(fileName.toLowerCase())
    result.push({ ...attachment, fileName })
  }
  return result
}
