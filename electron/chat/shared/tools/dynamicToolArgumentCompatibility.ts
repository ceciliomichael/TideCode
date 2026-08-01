import { isRecord } from './dynamicToolContracts'

/**
 * Repairs argument names that have a stable, tool-specific compatibility
 * mapping while leaving the provider-facing invocation untouched.
 *
 * Published tool schemas intentionally remain strict. These boundary-only
 * repairs exist for model calls that use a stable legacy shape despite having
 * received the canonical schema.
 */
export function normalizeDynamicToolExecutionArguments(
  toolId: string,
  argumentsValue: Record<string, unknown>,
): Record<string, unknown> {
  if (toolId === 'write') {
    return normalizeWriteArguments(argumentsValue)
  }

  if (toolId === 'edit') {
    return normalizeEditArguments(argumentsValue)
  }

  return argumentsValue
}

function normalizeWriteArguments(argumentsValue: Record<string, unknown>) {
  if ('path' in argumentsValue || typeof argumentsValue.file !== 'string') {
    return argumentsValue
  }

  const { file, ...remainingArguments } = argumentsValue
  return {
    ...remainingArguments,
    path: file,
  }
}

function normalizeEditArguments(argumentsValue: Record<string, unknown>) {
  const edits = argumentsValue.edits
  if (!Array.isArray(edits) || edits.length === 0 || !edits.every(isRecord)) {
    return argumentsValue
  }

  const itemPaths = edits.map((edit) => edit.path)
  const hasItemPaths = itemPaths.some((path) => path !== undefined)
  if (!hasItemPaths || !itemPaths.every((path) => typeof path === 'string' && path.trim().length > 0)) {
    return argumentsValue
  }

  if ('path' in argumentsValue && typeof argumentsValue.path !== 'string') {
    return argumentsValue
  }

  const sharedPath = typeof argumentsValue.path === 'string' ? argumentsValue.path : itemPaths[0]
  if (typeof sharedPath !== 'string' || sharedPath.trim().length === 0) {
    return argumentsValue
  }

  if (itemPaths.some((path) => path !== sharedPath)) {
    return argumentsValue
  }

  return {
    ...argumentsValue,
    edits: edits.map((edit) => Object.fromEntries(Object.entries(edit).filter(([key]) => key !== 'path'))),
    path: sharedPath,
  }
}
