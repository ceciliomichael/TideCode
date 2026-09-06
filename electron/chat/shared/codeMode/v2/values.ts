import { BLOCKED_MEMBER_NAMES, CodeModeRuntimeError, CodePromise, type AstNode } from './model'

const MAX_VALUE_DEPTH = 32

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function copyValue(
  value: unknown,
  label: string,
  depth: number,
  seen: Set<object>,
  node?: AstNode,
): unknown {
  if (depth > MAX_VALUE_DEPTH) {
    throw new CodeModeRuntimeError('TypeError', `${label} exceeds the maximum data depth of ${MAX_VALUE_DEPTH}.`, node)
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value instanceof CodePromise) {
    throw new CodeModeRuntimeError(
      'TypeError',
      `${label} contains an un-awaited Promise. Await tool calls before using their results.`,
      node,
    )
  }
  if (typeof value !== 'object') {
    throw new CodeModeRuntimeError('TypeError', `${label} must contain data values only.`, node)
  }
  if (seen.has(value)) {
    throw new CodeModeRuntimeError('TypeError', `${label} contains a circular value.`, node)
  }
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => copyValue(item, label, depth + 1, seen, node))
    }
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null
    if (!isPlainObject(value)) {
      throw new CodeModeRuntimeError('TypeError', `${label} must contain plain objects only.`, node)
    }
    const out: Record<string, unknown> = Object.create(null)
    for (const [key, item] of Object.entries(value)) {
      if (BLOCKED_MEMBER_NAMES.has(key)) {
        throw new CodeModeRuntimeError('TypeError', `${label} contains blocked property '${key}'.`, node)
      }
      out[key] = copyValue(item, label, depth + 1, seen, node)
    }
    return out
  } finally {
    seen.delete(value)
  }
}

export function copyBoundaryValue(value: unknown, label: string, node?: AstNode): unknown {
  return copyValue(value, label, 0, new Set(), node)
}

export function copyFinalValue(value: unknown, node?: AstNode): unknown {
  const copied = copyBoundaryValue(value, 'Code Mode result', node)
  if (copied === undefined) return undefined
  return JSON.parse(JSON.stringify(copied))
}

export function asDataObject(value: unknown, label: string, node?: AstNode): Record<string, unknown> {
  const copied = copyBoundaryValue(value, label, node)
  if (!copied || typeof copied !== 'object' || Array.isArray(copied)) {
    throw new CodeModeRuntimeError('TypeError', `${label} must be an object.`, node)
  }
  return copied as Record<string, unknown>
}

export function truthy(value: unknown): boolean {
  return Boolean(value)
}

export function requireNumber(value: unknown, label: string, node: AstNode): number {
  if (typeof value !== 'number') {
    throw new CodeModeRuntimeError('TypeError', `${label} must be a number.`, node)
  }
  return value
}

export function requireString(value: unknown, label: string, node: AstNode): string {
  if (typeof value !== 'string') {
    throw new CodeModeRuntimeError('TypeError', `${label} must be a string.`, node)
  }
  return value
}

export function safeErrorValue(error: unknown): Record<string, unknown> {
  if (error instanceof CodeModeRuntimeError) {
    return Object.assign(Object.create(null), { name: error.kind, message: error.message })
  }
  if (error instanceof Error) {
    return Object.assign(Object.create(null), { name: error.name || 'Error', message: error.message })
  }
  return Object.assign(Object.create(null), { name: 'Error', message: String(error) })
}
