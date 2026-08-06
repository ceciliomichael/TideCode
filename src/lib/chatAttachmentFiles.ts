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

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error(`Unable to read ${file.name || 'attachment'}.`))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`Unable to encode ${file.name || 'attachment'}.`))
        return
      }

      resolve(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

export async function readChatAttachmentsFromFiles(
  files: readonly File[],
  existingAttachmentCount: number,
): Promise<ReadChatAttachmentsResult> {
  const attachments: ChatAttachment[] = []
  const errors: string[] = []
  let remainingSlots = Math.max(CHAT_ATTACHMENT_MAX_COUNT - existingAttachmentCount, 0)

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
        attachments.push({
          dataUrl: await readFileAsDataUrl(file),
          fileName,
          id: crypto.randomUUID(),
          kind: 'image',
          mimeType: file.type || 'image/png',
          sizeBytes: file.size,
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
