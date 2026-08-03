import { getFileExtension } from './filePathUtils'

const IMAGE_PREVIEW_MIME_TYPES: Readonly<Record<string, string>> = {
  '.apng': 'image/apng',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jfif': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

export function getImagePreviewMimeType(relativePath: string) {
  return IMAGE_PREVIEW_MIME_TYPES[getFileExtension(relativePath)] ?? null
}

export function isImagePreviewablePath(relativePath: string) {
  return getImagePreviewMimeType(relativePath) !== null
}

export function createImagePreviewDataUrl(mimeType: string, base64Content: string) {
  return `data:${mimeType};base64,${base64Content}`
}
