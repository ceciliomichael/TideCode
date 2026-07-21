const MAX_EXTRA_BODY_BYTES = 64 * 1024
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const RESERVED_ROOT_KEYS = new Set(['messages', 'model', 'stream', 'tools'])

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function validateJsonValue(value: unknown, path: string, depth: number): void {
  if (depth > 20) {
    throw new Error('Extra request body cannot be nested more than 20 levels.')
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Extra request body contains a non-finite number at ${path}.`)
    }
    return
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateJsonValue(entry, `${path}[${index}]`, depth + 1))
    return
  }

  if (!isPlainRecord(value)) {
    throw new Error(`Extra request body contains an unsupported value at ${path}.`)
  }

  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`Extra request body cannot contain the key "${key}".`)
    }
    validateJsonValue(entry, `${path}.${key}`, depth + 1)
  }
}

export function parseExtraBody(input: unknown): Record<string, unknown> {
  if (input === undefined || input === null || input === '') {
    return {}
  }

  const parsed = typeof input === 'string' ? (JSON.parse(input) as unknown) : input
  if (!isPlainRecord(parsed)) {
    throw new Error('Extra request body must be a JSON object.')
  }

  const serialized = JSON.stringify(parsed)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_EXTRA_BODY_BYTES) {
    throw new Error('Extra request body must be 64 KB or smaller.')
  }

  for (const key of Object.keys(parsed)) {
    if (RESERVED_ROOT_KEYS.has(key)) {
      throw new Error(`Extra request body cannot override the reserved field "${key}".`)
    }
  }

  validateJsonValue(parsed, '$', 0)
  return JSON.parse(serialized) as Record<string, unknown>
}

export function formatExtraBody(input: Record<string, unknown> | undefined) {
  return input && Object.keys(input).length > 0 ? JSON.stringify(input, null, 2) : ''
}
