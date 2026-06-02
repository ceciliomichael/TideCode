import { getFileExtension, normalizePathSeparators } from './filePathUtils'

const MARKDOWN_PREVIEW_EXTENSIONS = new Set(['.md', '.markdown'])
const MARKDOWN_PREVIEW_TAB_KEY_PREFIX = 'markdown-preview::'

export function isMarkdownPreviewablePath(relativePath: string) {
  return MARKDOWN_PREVIEW_EXTENSIONS.has(getFileExtension(relativePath))
}

export function createMarkdownPreviewTabKey(relativePath: string) {
  return `${MARKDOWN_PREVIEW_TAB_KEY_PREFIX}${encodeURIComponent(normalizePathSeparators(relativePath))}`
}

export function isMarkdownPreviewTabKey(tabKey: string) {
  return tabKey.startsWith(MARKDOWN_PREVIEW_TAB_KEY_PREFIX)
}

export function getMarkdownPreviewSourcePath(tabKey: string) {
  if (!isMarkdownPreviewTabKey(tabKey)) {
    return null
  }

  const encodedPath = tabKey.slice(MARKDOWN_PREVIEW_TAB_KEY_PREFIX.length)
  if (encodedPath.length === 0) {
    return null
  }

  try {
    return decodeURIComponent(encodedPath)
  } catch {
    return null
  }
}
