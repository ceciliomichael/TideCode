/**
 * Repairs argument names that have a stable, tool-specific compatibility
 * mapping while leaving the provider-facing invocation untouched.
 *
 * The published write schema intentionally remains strict: `path` is the
 * canonical argument name. This boundary-only repair exists for model calls
 * that use the common synonym `file` despite having received the schema.
 */
export function normalizeDynamicToolExecutionArguments(
  toolId: string,
  argumentsValue: Record<string, unknown>,
): Record<string, unknown> {
  if (toolId !== 'write' || 'path' in argumentsValue || typeof argumentsValue.file !== 'string') {
    return argumentsValue
  }

  const { file, ...remainingArguments } = argumentsValue
  return {
    ...remainingArguments,
    path: file,
  }
}
