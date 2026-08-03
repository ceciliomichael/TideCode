import { getFileExtension } from './filePathUtils'

const DOCX_PREVIEW_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export function isDocxPreviewablePath(relativePath: string) {
  return getFileExtension(relativePath) === '.docx'
}

export function createDocxPreviewDataUrl(base64Content: string) {
  return `data:${DOCX_PREVIEW_MIME_TYPE};base64,${base64Content}`
}
