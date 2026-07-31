export interface StructuredToolResultSubject {
  kind?: string
  path?: string
}

export interface StructuredToolResultMetadata {
  arguments?: Record<string, unknown>
  schema: 'echosphere.tool_result/v1'
  semantics?: Record<string, unknown>
  status: 'error' | 'success'
  subject?: StructuredToolResultSubject
  summary: string
  toolCallId: string
  toolName: string
  truncated?: boolean
}

export interface ParsedStructuredToolResultContent {
  body: string | null
  metadata: StructuredToolResultMetadata | null
}

interface StructuredToolResultEnvelope {
  body?: string
  metadata: StructuredToolResultMetadata
  schema: 'echosphere.tool_result/v2'
}

const SKILL_LOCATION_PREAMBLE_PATTERN =
  /^Skill file:[^\r\n]*\r?\nSkill directory:[^\r\n]*\r?\nResolve relative resource and script paths from the skill directory above\.(?:\r?\n){1,2}/u

export const DEFAULT_MODEL_TOOL_RESULT_MAX_BYTES = 32 * 1024
export const DEFAULT_MODEL_TOOL_RESULT_TRUNCATION_MARKER =
  '\n\n[Tool result shortened for context efficiency. Use a narrower path, query, or read range to retrieve the omitted section.]\n\n'
const UTF8_ENCODER = new TextEncoder()

function utf8ByteLength(value: string) {
  return UTF8_ENCODER.encode(value).byteLength
}

function takeUtf8Prefix(value: string, maxBytes: number) {
  let byteLength = 0
  let endIndex = 0
  for (const character of value) {
    const characterBytes = utf8ByteLength(character)
    if (byteLength + characterBytes > maxBytes) {
      break
    }
    byteLength += characterBytes
    endIndex += character.length
  }
  return value.slice(0, endIndex)
}

function takeUtf8Suffix(value: string, maxBytes: number) {
  let byteLength = 0
  let startIndex = value.length
  const characters = Array.from(value)
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index]
    const characterBytes = utf8ByteLength(character)
    if (byteLength + characterBytes > maxBytes) {
      break
    }
    byteLength += characterBytes
    startIndex -= character.length
  }
  return value.slice(startIndex)
}

export function limitModelToolResultForContext(
  value: string,
  maxBytes = DEFAULT_MODEL_TOOL_RESULT_MAX_BYTES,
  marker = DEFAULT_MODEL_TOOL_RESULT_TRUNCATION_MARKER,
) {
  if (utf8ByteLength(value) <= maxBytes) {
    return value
  }

  const markerBytes = utf8ByteLength(marker)
  const contentBudget = maxBytes - markerBytes
  if (contentBudget <= 0) {
    return takeUtf8Prefix(value, maxBytes)
  }

  const headBudget = Math.floor(contentBudget * 0.65)
  const tailBudget = contentBudget - headBudget
  return `${takeUtf8Prefix(value, headBudget)}${marker}${takeUtf8Suffix(value, tailBudget)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readSubject(value: unknown): StructuredToolResultSubject | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const path = typeof value.path === 'string' ? value.path : undefined
  const kind = typeof value.kind === 'string' ? value.kind : undefined
  if (path === undefined && kind === undefined) {
    return undefined
  }

  return {
    ...(kind === undefined ? {} : { kind }),
    ...(path === undefined ? {} : { path }),
  }
}

function isStructuredToolResultMetadata(value: unknown): value is StructuredToolResultMetadata {
  if (!isRecord(value)) {
    return false
  }

  return (
    value.schema === 'echosphere.tool_result/v1' &&
    (value.status === 'success' || value.status === 'error') &&
    typeof value.summary === 'string' &&
    typeof value.toolCallId === 'string' &&
    typeof value.toolName === 'string' &&
    (value.truncated === undefined || typeof value.truncated === 'boolean') &&
    (value.arguments === undefined || isRecord(value.arguments)) &&
    (value.semantics === undefined || isRecord(value.semantics)) &&
    (value.subject === undefined || readSubject(value.subject) !== undefined)
  )
}

function isStructuredToolResultEnvelope(value: unknown): value is StructuredToolResultEnvelope {
  if (!isRecord(value)) {
    return false
  }

  return (
    value.schema === 'echosphere.tool_result/v2' &&
    isStructuredToolResultMetadata(value.metadata) &&
    (value.body === undefined || typeof value.body === 'string')
  )
}

function formatReadToolResultBody(metadata: StructuredToolResultMetadata, body: string | null) {
  const subjectPath = metadata.subject?.path?.trim() ?? ''
  const bodyText = body?.trim() ?? ''
  const headerLines: string[] = []

  if (subjectPath.length > 0) {
    headerLines.push(`${metadata.subject?.kind === 'directory' ? 'Directory' : 'File'}: ${subjectPath}`)
  }

  const offset = metadata.semantics && typeof metadata.semantics.offset === 'number' ? metadata.semantics.offset : null
  const entryCount =
    metadata.semantics && typeof metadata.semantics.entry_count === 'number' ? metadata.semantics.entry_count : null
  const revision =
    metadata.semantics && typeof metadata.semantics.revision === 'string' ? metadata.semantics.revision : null

  if (revision) {
    headerLines.push(`Revision: ${revision}`)
  }

  if (typeof offset === 'number' && offset > 1) {
    headerLines.push(`Offset: ${offset}`)
  }

  if (typeof entryCount === 'number') {
    headerLines.push(`Entry count: ${entryCount}`)
  }

  if (bodyText.length === 0) {
    return headerLines.join('\n')
  }

  return `${headerLines.join('\n')}\n\n${bodyText}`
}

function formatListToolResultBody(metadata: StructuredToolResultMetadata, body: string | null) {
  const subjectPath = metadata.subject?.path?.trim() ?? ''
  const bodyText = body?.trim() ?? ''
  const headerLines = subjectPath.length > 0 ? [`Directory: ${subjectPath}`] : []

  const count =
    metadata.semantics && typeof metadata.semantics.count === 'number' ? metadata.semantics.count : null

  if (typeof count === 'number') {
    headerLines.push(`Entries: ${count}`)
  }

  if (bodyText.length === 0) {
    return headerLines.join('\n')
  }

  return `${headerLines.join('\n')}\n\n${bodyText}`
}

export function formatStructuredToolResultContent(
  metadata: StructuredToolResultMetadata,
  body?: string | null,
) {
  // `body` is the model-facing text. If it is omitted, the summary becomes the fallback.
  const envelope: StructuredToolResultEnvelope = {
    ...(typeof body === 'string' && body.length > 0 ? { body } : {}),
    metadata,
    schema: 'echosphere.tool_result/v2',
  }

  return JSON.stringify(envelope, null, 2)
}

export function parseStructuredToolResultContent(content: string): ParsedStructuredToolResultContent {
  try {
    const parsedContent = JSON.parse(content) as unknown
    if (isStructuredToolResultEnvelope(parsedContent)) {
      return {
        body: parsedContent.body ?? null,
        metadata: parsedContent.metadata,
      }
    }
  } catch {
    // Invalid JSON means this is not a structured tool result envelope.
  }

  return {
    body: null,
    metadata: null,
  }
}

export function getToolResultModelContent(content: string) {
  // This is the final text that gets replayed to the model when history is rebuilt.
  const parsedContent = parseStructuredToolResultContent(content)
  let modelContent: string
  if (parsedContent.metadata?.toolName === 'read') {
    modelContent = formatReadToolResultBody(parsedContent.metadata, parsedContent.body)
  } else if (parsedContent.metadata?.toolName === 'list') {
    modelContent = formatListToolResultBody(parsedContent.metadata, parsedContent.body)
  } else if (parsedContent.body) {
    modelContent = parsedContent.body
  } else if (parsedContent.metadata?.summary.trim().length) {
    modelContent = parsedContent.metadata.summary.trim()
  } else {
    modelContent = content.trim()
  }

  return limitModelToolResultForContext(modelContent)
}

export function getToolResultDisplayBody(toolName: string, body: string) {
  if (toolName !== 'skill') {
    return body
  }

  return body.replace(SKILL_LOCATION_PREAMBLE_PATTERN, '')
}
