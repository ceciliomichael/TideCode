import type { ChatAttachment, ChatTextAttachment } from '../types/chat'

export const CHAT_ATTACHMENT_MAX_COUNT = 8
export const CHAT_ATTACHMENT_MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const CHAT_ATTACHMENT_MAX_TEXT_BYTES = 256 * 1024

const SUPPORTED_TEXT_ATTACHMENT_EXTENSIONS = new Set([
  '.bat',
  '.c',
  '.cfg',
  '.cpp',
  '.css',
  '.csv',
  '.env',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.log',
  '.md',
  '.mjs',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.sql',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
])

const SUPPORTED_TEXT_ATTACHMENT_MIME_TYPES = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/json',
  'application/ld+json',
  'application/sql',
  'application/toml',
  'application/typescript',
  'application/x-bat',
  'application/x-httpd-php',
  'application/x-python-code',
  'application/x-shellscript',
  'application/xml',
  'application/yaml',
  'text/css',
  'text/csv',
  'text/html',
  'text/javascript',
  'text/jsx',
  'text/markdown',
  'text/plain',
  'text/typescript',
  'text/x-c',
  'text/x-c++',
  'text/x-go',
  'text/x-java-source',
  'text/x-python',
  'text/x-ruby',
  'text/x-script.python',
  'text/x-script.ruby',
  'text/x-shellscript',
  'text/xml',
])

function escapeAttributeValue(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function getChatAttachmentExtension(fileName: string) {
  const lastDotIndex = fileName.lastIndexOf('.')
  if (lastDotIndex < 0) {
    return ''
  }

  return fileName.slice(lastDotIndex).toLowerCase()
}

export function isSupportedImageMimeType(mimeType: string) {
  return mimeType.trim().toLowerCase().startsWith('image/')
}

export function isSupportedTextAttachmentMimeType(mimeType: string) {
  const normalizedMimeType = mimeType.trim().toLowerCase()
  return normalizedMimeType.startsWith('text/') || SUPPORTED_TEXT_ATTACHMENT_MIME_TYPES.has(normalizedMimeType)
}

export function isSupportedTextAttachmentFileName(fileName: string) {
  return SUPPORTED_TEXT_ATTACHMENT_EXTENSIONS.has(getChatAttachmentExtension(fileName))
}

export function normalizeAttachmentText(input: string) {
  return input.replace(/\r\n/g, '\n')
}

export function getChatAttachmentLabel(attachment: ChatAttachment) {
  const trimmedName = attachment.fileName.trim()
  if (trimmedName.length > 0) {
    return trimmedName
  }

  return attachment.kind === 'image' ? 'Image attachment' : 'Text attachment'
}

export function getChatAttachmentSummary(attachments: readonly ChatAttachment[]) {
  if (attachments.length === 0) {
    return null
  }

  const firstLabel = getChatAttachmentLabel(attachments[0])
  if (attachments.length === 1) {
    return firstLabel
  }

  return `${firstLabel} +${attachments.length - 1} more`
}

export function buildTextAttachmentPrompt(attachment: ChatTextAttachment) {
  const fileName = escapeAttributeValue(getChatAttachmentLabel(attachment))
  const mimeType = escapeAttributeValue(attachment.mimeType)
  return [
    `<attached_file name="${fileName}" mime_type="${mimeType}">`,
    attachment.textContent,
    '</attached_file>',
  ].join('\n')
}

export function isChatAttachment(value: unknown): value is ChatAttachment {
  if (!value || typeof value !== 'object') {
    return false
  }

  const attachment = value as Partial<ChatAttachment>
  const hasSharedFields =
    typeof attachment.id === 'string' &&
    typeof attachment.fileName === 'string' &&
    typeof attachment.mimeType === 'string' &&
    typeof attachment.sizeBytes === 'number'

  if (!hasSharedFields) {
    return false
  }

  if (attachment.kind === 'image') {
    const hasValidDimensions =
      (attachment.width === undefined || (Number.isFinite(attachment.width) && attachment.width > 0)) &&
      (attachment.height === undefined || (Number.isFinite(attachment.height) && attachment.height > 0))
    return typeof attachment.dataUrl === 'string' && hasValidDimensions
  }

  if (attachment.kind === 'text') {
    return typeof attachment.textContent === 'string'
  }

  return false
}

export const CHAT_ATTACHMENT_INPUT_ACCEPT = [
  'image/*',
  ...Array.from(SUPPORTED_TEXT_ATTACHMENT_EXTENSIONS.values()),
].join(',')
