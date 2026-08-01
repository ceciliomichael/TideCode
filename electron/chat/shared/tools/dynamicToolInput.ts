import { isRecord, type DynamicExecuteInput } from './dynamicToolContracts'

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const allowedKeys = new Set(keys)
  return Object.keys(value).every((key) => allowedKeys.has(key))
}

function omitKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const omittedKeys = new Set(keys)
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omittedKeys.has(key)))
}

function unwrapArgumentEnvelope(value: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth >= 4 || !hasOnlyKeys(value, ['args']) || !isRecord(value.args)) {
    return value
  }

  return unwrapArgumentEnvelope(value.args, depth + 1)
}

function normalizeWrappedExecuteArguments(id: string, wrappedInput: Record<string, unknown>): DynamicExecuteInput {
  if (isRecord(wrappedInput.args)) {
    return {
      args: unwrapArgumentEnvelope({ ...omitKeys(wrappedInput, ['id', 'args']), ...wrappedInput.args }),
      id,
    }
  }

  return {
    args: omitKeys(wrappedInput, ['id']),
    id,
  }
}

function normalizeLegacyExecuteInput(value: Record<string, unknown>, depth = 0): DynamicExecuteInput | null {
  if (depth >= 4 || !hasOnlyKeys(value, ['args']) || !isRecord(value.args)) {
    return null
  }

  const wrappedInput = value.args
  if (typeof wrappedInput.id !== 'string') {
    return normalizeLegacyExecuteInput(wrappedInput, depth + 1)
  }

  return normalizeWrappedExecuteArguments(wrappedInput.id, wrappedInput)
}

/**
 * Normalizes the execute_tool transport without changing the native tool's
 * argument object. The canonical provider-facing shape is:
 *
 * { "id": "<catalog id>", "args": { ...native arguments } }
 *
 * Some providers have previously returned the call inside an additional outer
 * `args` property. Both of these compatibility shapes are accepted:
 *
 * { "args": { "id": "<catalog id>", "args": { ...native arguments } } }
 * { "args": { "id": "<catalog id>", ...native arguments } }
 *
 * The outer wrapper must contain only `args`; native arguments are still
 * validated against the selected catalog entry before dispatch.
 */
export function normalizeDynamicExecuteInput(value: unknown): DynamicExecuteInput | null {
  if (!isRecord(value)) {
    return null
  }

  if ('id' in value) {
    if (typeof value.id !== 'string' || !isRecord(value.args)) {
      return null
    }

    const nestedInput = value.args
    if (
      typeof nestedInput.id === 'string' &&
      nestedInput.id.trim() === value.id.trim() &&
      isRecord(nestedInput.args)
    ) {
      return normalizeWrappedExecuteArguments(value.id, nestedInput)
    }

    return value as unknown as DynamicExecuteInput
  }

  return normalizeLegacyExecuteInput(value)
}
