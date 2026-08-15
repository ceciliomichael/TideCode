const SKIPPABLE_WORKSPACE_TRAVERSAL_ERROR_CODES = new Set([
  'EACCES',
  'EISDIR',
  'ENOENT',
  'ENOTDIR',
  'EPERM',
])

function getErrorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null
  }

  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

export function isSkippableWorkspaceTraversalError(error: unknown) {
  const code = getErrorCode(error)
  return code !== null && SKIPPABLE_WORKSPACE_TRAVERSAL_ERROR_CODES.has(code)
}
