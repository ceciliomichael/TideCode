import { CodeModeRuntimeError } from './diagnostics'

const BLOCKED_MEMBER_NAMES = new Set(['__proto__', 'prototype', 'constructor'])

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
): unknown {
  if (depth > MAX_VALUE_DEPTH) {
    throw new CodeModeRuntimeError('TypeError', `${label} exceeds the maximum data depth of ${MAX_VALUE_DEPTH}.`)
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
  if (typeof value !== 'object') {
    throw new CodeModeRuntimeError('TypeError', `${label} must contain data values only.`)
  }
  if (seen.has(value)) {
    throw new CodeModeRuntimeError('TypeError', `${label} contains a circular value.`)
  }
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => copyValue(item, label, depth + 1, seen))
    }
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null
    if (!isPlainObject(value)) {
      throw new CodeModeRuntimeError('TypeError', `${label} must contain plain objects only.`)
    }
    const out: Record<string, unknown> = Object.create(null)
    for (const [key, item] of Object.entries(value)) {
      if (BLOCKED_MEMBER_NAMES.has(key)) {
        throw new CodeModeRuntimeError('TypeError', `${label} contains blocked property '${key}'.`)
      }
      out[key] = copyValue(item, label, depth + 1, seen)
    }
    return out
  } finally {
    seen.delete(value)
  }
}

export function copyBoundaryValue(value: unknown, label: string): unknown {
  return copyValue(value, label, 0, new Set())
}
