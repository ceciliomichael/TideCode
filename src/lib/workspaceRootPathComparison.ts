/**
 * Normalizes a workspace root path for equality comparisons between the
 * renderer and the main process. Windows drive paths are case-insensitive and
 * either separator style may appear depending on the path source, so both are
 * normalized before comparing.
 */
export function normalizeWorkspaceRootPathForComparison(workspaceRootPath: string) {
  const normalizedPath = workspaceRootPath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[a-z]:\//i.test(normalizedPath) ? normalizedPath.toLowerCase() : normalizedPath
}
