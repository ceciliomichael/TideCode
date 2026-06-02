export function normalizePathSeparators(input: string) {
  return input.replace(/\\/g, '/')
}

export function getFileExtension(input: string) {
  const normalizedPath = normalizePathSeparators(input).trim()
  if (normalizedPath.length === 0) {
    return ''
  }

  const pathSegments = normalizedPath.split('/').filter((segment) => segment.length > 0)
  const fileName = pathSegments[pathSegments.length - 1] ?? normalizedPath
  const lastDotIndex = fileName.lastIndexOf('.')
  if (lastDotIndex < 0) {
    return ''
  }

  return fileName.slice(lastDotIndex).toLowerCase()
}
