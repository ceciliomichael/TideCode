import {
  formatStructuredToolResultContent,
  parseStructuredToolResultContent,
  type StructuredToolResultMetadata,
} from '../../../../src/lib/toolResultContent'
import { stableStringify } from '../../cache/canonicalization'

export const CODE_MODE_NESTED_INVOCATION_MAX_CHARS = 2_000
export const CODE_MODE_OUTER_ARGUMENT_MAX_CHARS = 4_000
export const CODE_MODE_OUTER_RESULT_MAX_CHARS = 4_000

const MIDDLE_TRUNCATION_MARKER = '\n… [middle truncated] …\n'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function truncatePreservingEdges(value: string, maximumCharacters: number) {
  if (value.length <= maximumCharacters) return value
  if (maximumCharacters <= MIDDLE_TRUNCATION_MARKER.length + 2) {
    return value.slice(0, Math.max(0, maximumCharacters - 1)) + '…'
  }

  const availableCharacters = maximumCharacters - MIDDLE_TRUNCATION_MARKER.length
  const startCharacters = Math.ceil(availableCharacters / 2)
  const endCharacters = Math.floor(availableCharacters / 2)
  return `${value.slice(0, startCharacters)}${MIDDLE_TRUNCATION_MARKER}${value.slice(-endCharacters)}`
}

function stringifyValue(value: unknown) {
  return stableStringify(value) ?? String(value)
}

function projectOuterArgumentValue(value: unknown) {
  if (typeof value === 'string') {
    return truncatePreservingEdges(value, CODE_MODE_OUTER_ARGUMENT_MAX_CHARS)
  }

  if (isRecord(value)) {
    const projected = { ...value }
    for (const key of ['source', 'code', 'program']) {
      if (typeof projected[key] === 'string') {
        projected[key] = truncatePreservingEdges(projected[key], CODE_MODE_OUTER_ARGUMENT_MAX_CHARS)
      }
    }
    const serialized = stringifyValue(projected)
    return serialized.length <= CODE_MODE_OUTER_ARGUMENT_MAX_CHARS
      ? projected
      : truncatePreservingEdges(serialized, CODE_MODE_OUTER_ARGUMENT_MAX_CHARS)
  }

  return truncatePreservingEdges(stringifyValue(value), CODE_MODE_OUTER_ARGUMENT_MAX_CHARS)
}

function projectStructuredMetadataArguments(value: Record<string, unknown> | string) {
  if (typeof value === 'string') {
    return truncatePreservingEdges(value, CODE_MODE_OUTER_ARGUMENT_MAX_CHARS)
  }

  const projected = { ...value }
  for (const [key, nestedValue] of Object.entries(projected)) {
    if (typeof nestedValue !== 'string') continue
    const maximumCharacters = key === 'source' || key === 'code' || key === 'program'
      ? CODE_MODE_OUTER_ARGUMENT_MAX_CHARS
      : 500
    projected[key] = truncatePreservingEdges(nestedValue, maximumCharacters)
  }
  return projected
}

function readNestedToolCalls(metadata: StructuredToolResultMetadata) {
  const toolCalls = metadata.semantics?.tool_calls
  return Array.isArray(toolCalls) ? toolCalls : []
}

function projectNestedToolCall(value: unknown) {
  if (!isRecord(value)) return value

  const name = typeof value.name === 'string' ? value.name : 'unknown tool'
  const status = value.status === 'error' || value.status === 'success' ? value.status : 'unknown'
  const summary = typeof value.summary === 'string' ? value.summary : ''
  const subject = isRecord(value.subject) ? value.subject : undefined
  const argumentsValue = value.arguments === undefined ? undefined : stringifyValue(value.arguments)
  const body = typeof value.body === 'string' ? value.body : ''
  const base = {
    name,
    status,
    ...(summary ? { summary: truncatePreservingEdges(summary, 400) } : {}),
    ...(subject ? { subject } : {}),
  }
  const argumentsText = argumentsValue
    ? truncatePreservingEdges(argumentsValue, 500)
    : undefined
  const baseCharacters = JSON.stringify({
    ...base,
    ...(argumentsText ? { arguments: argumentsText } : {}),
    body: '',
  }).length
  const bodyCharacters = Math.max(
    120,
    CODE_MODE_NESTED_INVOCATION_MAX_CHARS - baseCharacters - 20,
  )
  const projected = {
    ...base,
    ...(argumentsText ? { arguments: argumentsText } : {}),
    ...(body ? { body: truncatePreservingEdges(body, bodyCharacters) } : {}),
  }

  if (JSON.stringify(projected).length <= CODE_MODE_NESTED_INVOCATION_MAX_CHARS) {
    return projected
  }

  const fallbackBase = {
    name,
    status,
    ...(summary ? { summary: truncatePreservingEdges(summary, 300) } : {}),
  }
  const fallbackBodyCharacters = Math.max(
    80,
    CODE_MODE_NESTED_INVOCATION_MAX_CHARS - JSON.stringify(fallbackBase).length - 20,
  )
  return {
    ...fallbackBase,
    ...(body ? { body: truncatePreservingEdges(body, fallbackBodyCharacters) } : {}),
  }
}

function projectCodeModeMetadata(metadata: StructuredToolResultMetadata): StructuredToolResultMetadata {
  const semantics = metadata.semantics
  return {
    ...metadata,
    ...(metadata.arguments === undefined ? {} : { arguments: projectStructuredMetadataArguments(metadata.arguments) }),
    ...(semantics
      ? {
          semantics: {
            ...semantics,
            tool_calls: readNestedToolCalls(metadata).map(projectNestedToolCall),
          },
        }
      : {}),
  }
}

export function projectCodeModeToolCallPart(part: Record<string, unknown>) {
  const projected = { ...part }
  for (const key of ['input', 'args', 'arguments']) {
    if (key in projected) {
      projected[key] = projectOuterArgumentValue(projected[key])
    }
  }
  return projected
}

export function projectCodeModeToolResultPart(part: Record<string, unknown>) {
  if (part.toolName !== 'code_mode' || !isRecord(part.output) || part.output.type !== 'text' || typeof part.output.value !== 'string') {
    return part
  }

  const parsed = parseStructuredToolResultContent(part.output.value)
  if (!parsed.metadata || parsed.metadata.toolName !== 'code_mode') {
    return {
      ...part,
      output: {
        ...part.output,
        value: truncatePreservingEdges(part.output.value, CODE_MODE_OUTER_RESULT_MAX_CHARS),
      },
    }
  }

  const projectedMetadata = projectCodeModeMetadata(parsed.metadata)
  const projectedBody = parsed.body === null
    ? parsed.body
    : truncatePreservingEdges(parsed.body, CODE_MODE_OUTER_RESULT_MAX_CHARS)
  return {
    ...part,
    output: {
      ...part.output,
      value: formatStructuredToolResultContent(projectedMetadata, projectedBody),
    },
  }
}
