export interface StructuredToolResultSubject {
  kind?: string
  path?: string
}

export interface StructuredToolResultMetadata {
  arguments?: Record<string, unknown>
  schema: 'tidecode.tool_result/v1'
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

export const TERMINATED_TOOL_EXECUTION_MESSAGE = 'Tool execution terminated'

export function createTerminatedToolResultContent(input: {
  argumentsValue: unknown
  toolCallId: string
  toolName: string
}) {
  return formatStructuredToolResultContent(
    {
      arguments:
        typeof input.argumentsValue === 'object' && input.argumentsValue !== null && !Array.isArray(input.argumentsValue)
          ? (input.argumentsValue as Record<string, unknown>)
          : undefined,
      schema: 'tidecode.tool_result/v1',
      status: 'error',
      summary: TERMINATED_TOOL_EXECUTION_MESSAGE,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
    },
    TERMINATED_TOOL_EXECUTION_MESSAGE,
  )
}

interface StructuredToolResultEnvelope {
  body?: string
  metadata: StructuredToolResultMetadata
  schema: 'tidecode.tool_result/v2'
}

const SKILL_LOCATION_PREAMBLE_PATTERN =
  /^Skill file:[^\r\n]*\r?\nSkill directory:[^\r\n]*\r?\nResolve relative resource and script paths from the skill directory above\.(?:\r?\n){1,2}/u

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
    value.schema === 'tidecode.tool_result/v1' &&
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
    value.schema === 'tidecode.tool_result/v2' &&
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

  if (headerLines.length === 0) {
    return bodyText
  }

  return `${headerLines.join('\n')}\n\n${bodyText}`
}

function formatListToolResultBody(metadata: StructuredToolResultMetadata, body: string | null) {
  const subjectPath = metadata.subject?.path?.trim() ?? ''
  const bodyText = body?.trim() ?? ''
  const headerLines = subjectPath.length > 0 ? [`Directory: ${subjectPath}`] : []

  const count = metadata.semantics && typeof metadata.semantics.count === 'number' ? metadata.semantics.count : null

  if (typeof count === 'number') {
    headerLines.push(`Entries: ${count}`)
  }

  if (bodyText.length === 0) {
    return headerLines.join('\n')
  }

  if (headerLines.length === 0) {
    return bodyText
  }

  return `${headerLines.join('\n')}\n\n${bodyText}`
}

export function formatStructuredToolResultContent(metadata: StructuredToolResultMetadata, body?: string | null) {
  // `body` is the model-facing text. If it is omitted, the summary becomes the fallback.
  const envelope: StructuredToolResultEnvelope = {
    ...(typeof body === 'string' && body.length > 0 ? { body } : {}),
    metadata,
    schema: 'tidecode.tool_result/v2',
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

  return modelContent
}

export function getToolResultDisplayBody(toolName: string, body: string) {
  let displayBody = body

  if (toolName === 'edit') {
    displayBody = removeInternalNextFieldsFromJson(displayBody)
  }

  if (toolName === 'skill') {
    return displayBody.replace(SKILL_LOCATION_PREAMBLE_PATTERN, '')
  }

  return displayBody
}

function removeInternalNextFieldsFromJson(body: string) {
  try {
    const parsed = JSON.parse(body) as unknown
    let changed = false

    const stripFields = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.map(stripFields)
      }

      if (!isRecord(value)) {
        return value
      }

      const cleaned: Record<string, unknown> = {}
      for (const [key, nestedValue] of Object.entries(value)) {
        if (key === 'next' || key === 'nextStep') {
          changed = true
          continue
        }
        cleaned[key] = stripFields(nestedValue)
      }
      return cleaned
    }

    const cleaned = stripFields(parsed)
    return changed ? JSON.stringify(cleaned, null, 2) : body
  } catch {
    return body
  }
}
