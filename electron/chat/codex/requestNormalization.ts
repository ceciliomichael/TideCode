type JsonRecord = Record<string, unknown>

export class CodexRequestNormalizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodexRequestNormalizationError'
  }
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeCodexItemId(id: unknown): unknown {
  if (typeof id !== 'string') return id
  if (id.startsWith('tsc')) return id
  if (id.startsWith('call_')) return id.replace(/^call_/u, 'tsc_')
  return `tsc_${id}`
}

function parseFunctionArguments(argumentsValue: unknown): JsonRecord {
  if (argumentsValue === undefined || argumentsValue === null) {
    return {}
  }

  if (isJsonRecord(argumentsValue)) {
    return argumentsValue
  }

  if (typeof argumentsValue !== 'string') {
    throw new CodexRequestNormalizationError(
      `Codex function-call arguments must be a JSON object, received ${Array.isArray(argumentsValue) ? 'an array' : typeof argumentsValue}.`,
    )
  }

  const normalizedArguments = argumentsValue.trim()
  if (normalizedArguments.length === 0) {
    return {}
  }

  let parsedArguments: unknown
  try {
    parsedArguments = JSON.parse(normalizedArguments) as unknown
  } catch {
    throw new CodexRequestNormalizationError('Codex function-call arguments are not valid JSON.')
  }

  if (!isJsonRecord(parsedArguments)) {
    throw new CodexRequestNormalizationError('Codex function-call arguments must decode to a JSON object.')
  }

  return parsedArguments
}

function getFunctionCallInputType(record: JsonRecord): 'responses' | 'legacy' | null {
  const itemType = typeof record.type === 'string' ? record.type : ''
  const isOutput =
    itemType === 'function_call_output' ||
    itemType === 'tool_result' ||
    'output' in record

  if (isOutput) return null
  if (itemType === 'function_call') return 'responses'
  if (itemType === 'tool_call' || itemType === 'function' || 'call_id' in record || 'name' in record) {
    return 'legacy'
  }

  return null
}

function isFunctionCallItem(record: JsonRecord): boolean {
  const itemType = typeof record.type === 'string' ? record.type : ''
  return (
    itemType === 'function_call' ||
    itemType === 'tool_call' ||
    itemType === 'function' ||
    (itemType.length === 0 && ('call_id' in record || 'name' in record))
  )
}

function serializeResponsesFunctionArguments(argumentsValue: unknown): string {
  if (argumentsValue === undefined || argumentsValue === null) {
    return '{}'
  }

  if (typeof argumentsValue === 'string') {
    return JSON.stringify(parseFunctionArguments(argumentsValue))
  }

  if (isJsonRecord(argumentsValue)) {
    return JSON.stringify(argumentsValue)
  }

  throw new CodexRequestNormalizationError(
    `Codex Responses function-call arguments must be a JSON object, received ${Array.isArray(argumentsValue) ? 'an array' : typeof argumentsValue}.`,
  )
}

function normalizeCodexInputItem(item: unknown): unknown {
  if (!isJsonRecord(item)) return item

  const normalizedItem: JsonRecord = { ...item }
  const functionCallInputType = getFunctionCallInputType(normalizedItem)
  if ('id' in normalizedItem && isFunctionCallItem(normalizedItem)) {
    // Codex requires the Responses input item's own id to use the tsc_ namespace.
    // Keep call_id unchanged because it is the foreign key shared by a function
    // call and its function_call_output item.
    normalizedItem.id = normalizeCodexItemId(normalizedItem.id)
  }

  if (functionCallInputType === 'responses') {
    // The Responses API uses a JSON-encoded string for function_call.arguments.
    normalizedItem.arguments = serializeResponsesFunctionArguments(normalizedItem.arguments)
  } else if (functionCallInputType === 'legacy') {
    // Older providers may replay tool_call/function items with object arguments.
    // The Codex compatibility endpoint expects those legacy items as objects.
    normalizedItem.arguments = parseFunctionArguments(normalizedItem.arguments)
  } else {
    // Codex rejects arguments on non-call input items, including tool outputs.
    delete normalizedItem.arguments
  }

  return normalizedItem
}

export function normalizeCodexRequestBody(body: string): string {
  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(body) as unknown
  } catch {
    return body
  }

  if (!isJsonRecord(parsedBody)) return body

  const normalizedBody: JsonRecord = { ...parsedBody }
  if ('max_output_tokens' in normalizedBody) {
    delete normalizedBody.max_output_tokens
  }

  if (Array.isArray(normalizedBody.input)) {
    normalizedBody.input = normalizedBody.input.map(normalizeCodexInputItem)
  }

  return JSON.stringify(normalizedBody)
}
