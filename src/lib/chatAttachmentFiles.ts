import {
  CHAT_ATTACHMENT_INPUT_ACCEPT,
  CHAT_ATTACHMENT_MAX_COUNT,
  CHAT_ATTACHMENT_MAX_IMAGE_BYTES,
  CHAT_ATTACHMENT_MAX_TEXT_BYTES,
  getChatAttachmentExtension,
  isSupportedImageMimeType,
  isSupportedTextAttachmentFileName,
  isSupportedTextAttachmentMimeType,
  normalizeAttachmentText,
} from './chatAttachments'
import type { ChatAttachment } from '../types/chat'
import { normalizeChatImageFile } from './chatImageNormalization'
import { toUserFacingErrorMessage } from './userFacingError'

export { CHAT_ATTACHMENT_INPUT_ACCEPT }

interface ReadChatAttachmentsResult {
  attachments: ChatAttachment[]
  errors: string[]
}

const IMAGE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
}

function inferAttachmentKind(file: File) {
  if (isSupportedImageMimeType(file.type)) {
    return 'image'
  }

  if (isSupportedTextAttachmentMimeType(file.type) || isSupportedTextAttachmentFileName(file.name)) {
    return 'text'
  }

  return null
}

function getFallbackFileName(file: File, attachmentKind: ChatAttachment['kind']) {
  const trimmedName = file.name.trim()
  if (trimmedName.length > 0) {
    return trimmedName
  }

  if (attachmentKind === 'image') {
    const extension = IMAGE_EXTENSION_BY_MIME_TYPE[file.type.trim().toLowerCase()] ?? 'png'
    return `clipboard-image.${extension}`
  }

  const inferredExtension = getChatAttachmentExtension(file.name)
  return inferredExtension.length > 0 ? `clipboard-file${inferredExtension}` : 'clipboard-file.txt'
}

export async function readChatAttachmentsFromFiles(
  files: readonly File[],
  existingAttachments: readonly ChatAttachment[],
): Promise<ReadChatAttachmentsResult> {
  const attachments: ChatAttachment[] = []
  const errors: string[] = []
  let remainingSlots = Math.max(CHAT_ATTACHMENT_MAX_COUNT - existingAttachments.length, 0)
  const attachedImageDataUrls = new Set(
    existingAttachments
      .filter((attachment) => attachment.kind === 'image')
      .map((attachment) => attachment.dataUrl),
  )

  for (const file of files) {
    if (remainingSlots === 0) {
      errors.push(`You can attach up to ${CHAT_ATTACHMENT_MAX_COUNT} files per message.`)
      break
    }

    const attachmentKind = inferAttachmentKind(file)
    const fileName = getFallbackFileName(file, attachmentKind ?? 'text')

    if (!attachmentKind) {
      errors.push(`Unsupported attachment type: ${fileName}`)
      continue
    }

    if (attachmentKind === 'image') {
      if (file.size > CHAT_ATTACHMENT_MAX_IMAGE_BYTES) {
        errors.push(`${fileName} is too large. Images must be 8 MB or smaller.`)
        continue
      }

      try {
        const normalizedImage = await normalizeChatImageFile(file)
        if (attachedImageDataUrls.has(normalizedImage.dataUrl)) {
          errors.push(`${fileName} is already attached.`)
          continue
        }
        attachedImageDataUrls.add(normalizedImage.dataUrl)
        attachments.push({
          dataUrl: normalizedImage.dataUrl,
          fileName,
          height: normalizedImage.height,
          id: crypto.randomUUID(),
          kind: 'image',
          mimeType: normalizedImage.mimeType,
          sizeBytes: normalizedImage.sizeBytes,
          width: normalizedImage.width,
        })
        remainingSlots -= 1
      } catch (error) {
        errors.push(toUserFacingErrorMessage(error, `Unable to read ${fileName}.`))
      }

      continue
    }

    if (file.size > CHAT_ATTACHMENT_MAX_TEXT_BYTES) {
      errors.push(`${fileName} is too large. Text files must be 256 KB or smaller.`)
      continue
    }

    try {
      attachments.push({
        fileName,
        id: crypto.randomUUID(),
        kind: 'text',
        mimeType: file.type || 'text/plain',
        sizeBytes: file.size,
        textContent: normalizeAttachmentText(await file.text()),
      })
      remainingSlots -= 1
    } catch (error) {
      errors.push(toUserFacingErrorMessage(error, `Unable to read ${fileName}.`))
    }
  }

  return {
    attachments,
    errors,
  }
}
