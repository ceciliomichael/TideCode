import { getFileExtension, normalizePathSeparators } from './filePathUtils'

const SVG_PREVIEW_EXTENSIONS = new Set(['.svg'])
const SVG_PREVIEW_TAB_KEY_PREFIX = 'svg-preview::'

export function isSvgPreviewablePath(relativePath: string) {
  return SVG_PREVIEW_EXTENSIONS.has(getFileExtension(relativePath))
}

export function createSvgPreviewTabKey(relativePath: string) {
  return `${SVG_PREVIEW_TAB_KEY_PREFIX}${encodeURIComponent(normalizePathSeparators(relativePath))}`
}

export function isSvgPreviewTabKey(tabKey: string) {
  return tabKey.startsWith(SVG_PREVIEW_TAB_KEY_PREFIX)
}

export function getSvgPreviewSourcePath(tabKey: string) {
  if (!isSvgPreviewTabKey(tabKey)) {
    return null
  }

  const encodedPath = tabKey.slice(SVG_PREVIEW_TAB_KEY_PREFIX.length)
  if (encodedPath.length === 0) {
    return null
  }

  try {
    return decodeURIComponent(encodedPath)
  } catch {
    return null
  }
}
