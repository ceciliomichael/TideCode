import type { FileIconConfig } from './fileIconConfig'
import { DEFAULT_CODE_ICON, DEFAULT_FILE_ICON, LANGUAGE_ICONS, LANGUAGE_ID_TO_EXTENSION } from './fileIconConfig'

interface ResolveFileIconOptions {
  fileName?: string
  languageId?: string
  mimeType?: string
}

const SPECIAL_FILE_EXTENSION_FAMILIES: Readonly<Record<string, string>> = {
  '.env': 'env',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
}

function getExtensionFromFileName(fileName: string) {
  const trimmedName = fileName.trim()
  if (trimmedName.length === 0) {
    return ''
  }

  const normalizedName = trimmedName.toLowerCase().replace(/\\/g, '/')
  const pathSegments = normalizedName.split('/')
  const basename = pathSegments[pathSegments.length - 1] ?? ''

  if (basename.length === 0) {
    return ''
  }

  const specialExtension = Object.entries(SPECIAL_FILE_EXTENSION_FAMILIES).find(
    ([specialFileName]) => basename === specialFileName || basename.startsWith(specialFileName + '.'),
  )?.[1]
  if (specialExtension) {
    return specialExtension
  }

  if (basename.startsWith('.') && basename.indexOf('.', 1) < 0) {
    return basename.slice(1)
  }

  const lastDotIndex = basename.lastIndexOf('.')
  if (lastDotIndex < 0) {
    return basename
  }

  return basename.slice(lastDotIndex + 1)
}

function inferExtensionFromMimeType(mimeType: string) {
  const normalizedMimeType = mimeType.trim().toLowerCase()
  if (normalizedMimeType.length === 0) {
    return ''
  }

  if (normalizedMimeType.includes('json')) {
    return 'json'
  }

  if (normalizedMimeType.includes('markdown')) {
    return 'md'
  }

  if (normalizedMimeType.includes('csv')) {
    return 'csv'
  }

  if (normalizedMimeType.includes('yaml')) {
    return 'yaml'
  }

  if (normalizedMimeType.includes('xml')) {
    return 'xml'
  }

  if (normalizedMimeType.startsWith('image/')) {
    return normalizedMimeType.slice('image/'.length).replace('+xml', '')
  }

  if (normalizedMimeType.startsWith('video/')) {
    return normalizedMimeType.slice('video/'.length)
  }

  if (normalizedMimeType.startsWith('audio/')) {
    return normalizedMimeType.slice('audio/'.length)
  }

  return ''
}

function getIconByExtension(extension: string) {
  if (extension.length === 0) {
    return null
  }

  return LANGUAGE_ICONS[extension] ?? null
}

function normalizeLanguageId(languageId: string) {
  return languageId.trim().toLowerCase()
}

export function resolveFileIconConfig({
  fileName,
  languageId,
  mimeType,
}: ResolveFileIconOptions): FileIconConfig {
  if (languageId) {
    const mappedExtension = LANGUAGE_ID_TO_EXTENSION[normalizeLanguageId(languageId)]
    if (mappedExtension) {
      return LANGUAGE_ICONS[mappedExtension] ?? DEFAULT_CODE_ICON
    }

    const iconByLanguageId = getIconByExtension(normalizeLanguageId(languageId))
    if (iconByLanguageId) {
      return iconByLanguageId
    }
  }

  if (fileName) {
    const iconByFileName = getIconByExtension(getExtensionFromFileName(fileName))
    if (iconByFileName) {
      return iconByFileName
    }
  }

  if (mimeType) {
    const iconByMimeType = getIconByExtension(inferExtensionFromMimeType(mimeType))
    if (iconByMimeType) {
      return iconByMimeType
    }
  }

  return languageId ? DEFAULT_CODE_ICON : DEFAULT_FILE_ICON
}
