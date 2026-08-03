import { getFileExtension } from './filePathUtils'

const PDF_PREVIEW_MIME_TYPE = 'application/pdf'

export function isPdfPreviewablePath(relativePath: string) {
  return getFileExtension(relativePath) === '.pdf'
}

export function createPdfPreviewDataUrl(base64Content: string) {
  return `data:${PDF_PREVIEW_MIME_TYPE};base64,${base64Content}`
}
