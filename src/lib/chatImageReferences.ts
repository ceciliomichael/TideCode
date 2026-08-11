import type { ChatAttachment, ChatImageAttachment } from '../types/chat'

const CHAT_IMAGE_REFERENCE_PATTERN = /\[Image #([1-9]\d*)\]/g

export interface ChatImageReferenceMatch {
  end: number
  imageIndex: number
  imageNumber: number
  start: number
  text: string
}

export type ChatImageReferenceSegment =
  | { text: string; type: 'text' }
  | { imageIndex: number; imageNumber: number; text: string; type: 'image' }

export function getChatImageAttachments(attachments: readonly ChatAttachment[]) {
  return attachments.filter((attachment): attachment is ChatImageAttachment => attachment.kind === 'image')
}

export function buildChatImageReferenceLabel(imageNumber: number) {
  return `[Image #${Math.max(1, Math.floor(imageNumber))}]`
}

export function findChatImageReferenceMatches(text: string, imageCount = Number.POSITIVE_INFINITY) {
  const matches: ChatImageReferenceMatch[] = []
  const pattern = new RegExp(CHAT_IMAGE_REFERENCE_PATTERN.source, 'g')
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    const imageNumber = Number.parseInt(match[1] ?? '', 10)
    const imageIndex = imageNumber - 1
    if (imageIndex < 0 || imageIndex >= imageCount) {
      continue
    }
    matches.push({
      end: match.index + match[0].length,
      imageIndex,
      imageNumber,
      start: match.index,
      text: match[0],
    })
  }

  return matches
}

export function splitChatImageReferenceSegments(text: string, imageCount: number) {
  const matches = findChatImageReferenceMatches(text, imageCount)
  if (matches.length === 0) {
    return text.length > 0 ? [{ text, type: 'text' as const }] : []
  }

  const segments: ChatImageReferenceSegment[] = []
  let cursor = 0
  for (const match of matches) {
    if (match.start > cursor) {
      segments.push({ text: text.slice(cursor, match.start), type: 'text' })
    }
    segments.push({
      imageIndex: match.imageIndex,
      imageNumber: match.imageNumber,
      text: match.text,
      type: 'image',
    })
    cursor = match.end
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), type: 'text' })
  }
  return segments
}

export function ensureChatImageReferences(text: string, attachments: readonly ChatAttachment[]) {
  const imageCount = getChatImageAttachments(attachments).length
  if (imageCount === 0) {
    return text
  }

  const referencedNumbers = new Set(
    findChatImageReferenceMatches(text, imageCount).map((match) => match.imageNumber),
  )
  const missingLabels = Array.from({ length: imageCount }, (_, index) => index + 1)
    .filter((imageNumber) => !referencedNumbers.has(imageNumber))
    .map(buildChatImageReferenceLabel)
  if (missingLabels.length === 0) {
    return text
  }

  const separator = text.length === 0 || /\s$/u.test(text) ? '' : ' '
  return `${text}${separator}${missingLabels.join(' ')}`
}

export function insertChatImageReferences(input: {
  count: number
  firstImageNumber: number
  position: number
  text: string
}) {
  const position = Math.max(0, Math.min(input.position, input.text.length))
  const labels = Array.from({ length: input.count }, (_, index) => (
    buildChatImageReferenceLabel(input.firstImageNumber + index)
  )).join(' ')
  if (labels.length === 0) {
    return { cursorPosition: position, text: input.text }
  }

  const before = input.text.slice(0, position)
  const after = input.text.slice(position)
  const leadingSpace = before.length > 0 && !/\s$/u.test(before) ? ' ' : ''
  const trailingSpace = after.length > 0 && !/^\s/u.test(after) ? ' ' : ''
  const insertion = `${leadingSpace}${labels}${trailingSpace}`
  return {
    cursorPosition: position + insertion.length,
    text: `${before}${insertion}${after}`,
  }
}

export function removeChatImageReference(input: {
  attachments: readonly ChatAttachment[]
  imageNumber: number
  text: string
}) {
  const targetImageIndex = input.imageNumber - 1
  const images = getChatImageAttachments(input.attachments)
  const targetImage = images[targetImageIndex]
  if (!targetImage) {
    return { attachments: [...input.attachments], text: input.text }
  }

  const nextAttachments = input.attachments.filter((attachment) => attachment.id !== targetImage.id)
  const nextText = input.text
    .replace(new RegExp(`\\[Image #${input.imageNumber}\\]`, 'g'), '')
    .replace(CHAT_IMAGE_REFERENCE_PATTERN, (reference, rawNumber: string) => {
      const imageNumber = Number.parseInt(rawNumber, 10)
      return imageNumber > input.imageNumber
        ? buildChatImageReferenceLabel(imageNumber - 1)
        : reference
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/ +\n/g, '\n')
    .trimEnd()

  return { attachments: nextAttachments, text: nextText }
}

export function findChatImageReferenceForDeletion(input: {
  key: 'Backspace' | 'Delete'
  selectionEnd: number
  selectionStart: number
  text: string
  imageCount: number
}) {
  const matches = findChatImageReferenceMatches(input.text, input.imageCount)
  if (input.selectionStart !== input.selectionEnd) {
    return matches.find((match) => (
      match.start < input.selectionEnd && match.end > input.selectionStart
    )) ?? null
  }

  const cursor = input.selectionStart
  return matches.find((match) => (
    input.key === 'Backspace'
      ? cursor > match.start && cursor <= match.end
      : cursor >= match.start && cursor < match.end
  )) ?? null
}
