export function normalizeExplorerRelativePath(relativePath: string) {
  return relativePath.trim().replace(/\\/gu, '/').replace(/^\.\//u, '')
}

export function resolveExplorerAbsolutePath(workspaceRootPath: string, relativePath: string) {
  const normalizedRootPath = workspaceRootPath.trim().replace(/[\\/]+$/u, '')
  const normalizedRelativePath = normalizeExplorerRelativePath(relativePath)
  if (normalizedRelativePath.length === 0 || normalizedRelativePath === '.') {
    return normalizedRootPath
  }

  const separator = normalizedRootPath.includes('\\') && !normalizedRootPath.includes('/') ? '\\' : '/'
  return `${normalizedRootPath}${separator}${normalizedRelativePath.replace(/\//gu, separator)}`
}
