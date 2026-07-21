const RESERVED_ROOT_KEYS = new Set(['messages', 'model', 'stream', 'tools'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseModelExtraBodyText(value: string): Record<string, unknown> {
  if (!value.trim()) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new Error('Extra settings must contain valid JSON.')
  }
  if (!isRecord(parsed)) throw new Error('Extra settings must be a JSON object.')
  for (const key of Object.keys(parsed)) {
    if (RESERVED_ROOT_KEYS.has(key)) {
      throw new Error(`Extra settings cannot replace the reserved field "${key}".`)
    }
  }
  return parsed
}

export function formatModelExtraBody(value: Record<string, unknown> | undefined) {
  return value && Object.keys(value).length > 0 ? JSON.stringify(value, null, 2) : ''
}
