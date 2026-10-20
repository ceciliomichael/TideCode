import type { ModelMessage } from 'ai'
import { parseStructuredToolResultContent } from '../../../../src/lib/toolResultContent'
import { truncatePreservingEdges } from './codeModeProjection'

const MAX_RESULTS = 100
const MAX_RESULT_CHARS = 1_600
const MAX_BATCH_CHARS = 24_000
const MAX_PLAIN_OUTPUT_CHARS = 2_000

export interface NestedToolEvidence {
  name: string
  status: 'error' | 'success'
  summary: string
  subject?: string
  command?: string
  state?: string
  exitCode?: number | null
  sessionId?: string | number
  incomplete?: boolean
  body?: string
}

export interface CodeModeEvidence {
  summary: string
  status: 'error' | 'success' | 'unknown'
  results: NestedToolEvidence[]
  omittedResults: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedText(value: unknown, limit: number) {
  if (typeof value !== 'string') return undefined
  return truncatePreservingEdges(value, limit)
}

// Explicit exec returns use a JSON structure followed by readable ToolResult
// bodies. Find its closing boundary without mistaking brackets in strings for
// structure or repeatedly attempting to parse an increasingly large prefix.
function readLeadingJson(text: string) {
  const start = text.search(/\S/u)
  if (start < 0 || (text[start] !== '[' && text[start] !== '{')) return null
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        quoted = false
      }
      continue
    }
    if (character === '"') {
      quoted = true
    } else if (character === '[' || character === '{') {
      depth += 1
    } else if (character === ']' || character === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return { value: JSON.parse(text.slice(start, index + 1)) as unknown, remainder: text.slice(index + 1) }
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function readNestedResult(value: Record<string, unknown>, body: string | undefined): NestedToolEvidence | null {
  const status = value.status
  if ((status !== 'error' && status !== 'success') || typeof value.summary !== 'string') return null
  const semantics = isRecord(value.semantics) ? value.semantics : {}
  const argumentsValue = isRecord(value.arguments) ? value.arguments : {}
  const subject = isRecord(value.subject) ? value.subject : {}
  const state = boundedText(semantics.state ?? value.state, 24)
  const exitCode = 'exit_code' in semantics ? semantics.exit_code : value.exit_code
  const sessionId = semantics.session_id ?? value.session_id
  const subjectText = [subject.kind, subject.path].filter((part) => typeof part === 'string').join(': ')
  const incomplete = value.truncated === true || value.body_omitted === true || semantics.output_evicted === true ||
    semantics.next_offset != null || semantics.next_cursor != null
  return {
    name: boundedText(value.name, 48) ?? 'returned tool result',
    status,
    summary: boundedText(value.summary, 240) ?? '',
    ...(subjectText ? { subject: truncatePreservingEdges(subjectText, 200) } : {}),
    ...(typeof argumentsValue.command === 'string' ? { command: truncatePreservingEdges(argumentsValue.command, 300) } : {}),
    ...(state ? { state } : {}),
    ...(typeof exitCode === 'number' && Number.isFinite(exitCode) ? { exitCode } : {}),
    ...(exitCode === null ? { exitCode: null } : {}),
    ...(typeof sessionId === 'string' ? { sessionId: truncatePreservingEdges(sessionId, 16) } : {}),
    ...(typeof sessionId === 'number' && Number.isFinite(sessionId) ? { sessionId } : {}),
    ...(incomplete ? { incomplete: true } : {}),
    ...(body ? { body: truncatePreservingEdges(body, 1_000) } : {}),
  }
}

export function readCodeModeEvidence(text: string): CodeModeEvidence | null {
  const parsed = parseStructuredToolResultContent(text)
  const metadata = parsed.metadata
  if (metadata?.toolName === 'exec') {
    const calls = metadata.semantics?.tool_calls
    if (!Array.isArray(calls)) return null
    const results = calls.flatMap((call) => {
      if (!isRecord(call)) return []
      const result = readNestedResult(call, typeof call.body === 'string' ? call.body : undefined)
      return result ? [result] : []
    })
    return {
      summary: truncatePreservingEdges(metadata.summary, 300),
      status: metadata.status,
      results: results.slice(0, MAX_RESULTS),
      omittedResults: Math.max(0, calls.length - Math.min(results.length, MAX_RESULTS)),
    }
  }

  const header = /^Code Mode[^\r\n]*\r?\n\r?\n/u.exec(text)
  if (!header) return null
  const returned = readLeadingJson(text.slice(header[0].length))
  if (!returned) return null
  const remainder = returned.remainder
  const sections = [...remainder.matchAll(/^ToolResult (\d+) \((success|error)\): ([^\r\n]*)\r?$/gmu)]
  const results: NestedToolEvidence[] = []
  let resultCount = 0
  let visited = 0
  function visit(value: unknown, depth: number) {
    visited += 1
    if (visited > 10_000 || depth > 32) return
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1)
      }
      return
    }
    if (!isRecord(value)) return
    const bodyValue = typeof value.body === 'string' ? value.body : undefined
    const reference = bodyValue ? /^\[ToolResult (\d+) body below\]$/u.exec(bodyValue) : null
    let body = bodyValue
    if (reference) {
      body = undefined
      const matchingSections = sections.filter((section) => (
        section[1] === reference[1] && section[2] === value.status && section[3] === value.summary
      ))
      if (matchingSections.length === 1) {
        const section = matchingSections[0]
        const next = sections[sections.indexOf(section) + 1]
        body = remainder.slice(section.index + section[0].length, next?.index).trim()
      }
    }
    const result = readNestedResult(value, body)
    if (result) {
      resultCount += 1
      if (results.length < MAX_RESULTS) {
        results.push(result)
      }
      return
    }
    for (const item of Object.values(value)) {
      visit(item, depth + 1)
    }
  }
  visit(returned.value, 0)
  if (results.length === 0) return null
  return {
    summary: truncatePreservingEdges(header[0].trim(), 300),
    // A readable wrapper's completion text is not a verified outer status.
    status: 'unknown',
    results,
    omittedResults: Math.max(0, resultCount - results.length),
  }
}

export function formatNestedToolEvidence(result: NestedToolEvidence, maximumCharacters = MAX_RESULT_CHARS) {
  // Operational state comes first: a successful API call can still have started
  // a running command or returned a nonzero process exit code.
  const fields = [
    `${result.name}: tool_status=${result.status}`,
    ...(result.state ? [`state=${result.state}`] : []),
    ...(result.exitCode !== undefined ? [`exit_code=${result.exitCode}`] : []),
    ...(result.sessionId !== undefined ? [`session=${result.sessionId}`] : []),
    ...(result.incomplete ? ['partial_output=true'] : []),
  ]
  const details = [
    ...(result.command ? [`command=${result.command}`] : []),
    ...(result.subject ? [result.subject] : []),
    result.summary,
    ...(result.body ? [result.body] : []),
  ].join('\n')
  const state = fields.join('; ')
  const remaining = Math.max(0, maximumCharacters - state.length - 1)
  if (remaining === 0) return state
  return `${state}\n${truncatePreservingEdges(details, remaining)}`
}

function compactToolText(text: string, isExec: boolean) {
  const evidence = isExec ? readCodeModeEvidence(text) : null
  if (!evidence) return truncatePreservingEdges(text, MAX_PLAIN_OUTPUT_CHARS)
  const perResult = Math.min(MAX_RESULT_CHARS, Math.floor((MAX_BATCH_CHARS - 1_000) / Math.max(1, evidence.results.length)))
  const lines = [
    evidence.summary,
    'Nested tool-result evidence (each outcome is scoped to its operation, not overall task completion):',
    ...evidence.results.map((result, index) => `${index + 1}. ${formatNestedToolEvidence(result, perResult)}`),
  ]
  if (evidence.omittedResults > 0) {
    lines.push(`[${evidence.omittedResults} nested outcomes omitted; do not infer their results.]`)
  }
  return lines.join('\n\n')
}

export function compactToolResultMessage(message: ModelMessage): ModelMessage {
  if (message.role !== 'tool' || !Array.isArray(message.content)) return message
  return {
    ...message,
    content: message.content.map((part) => {
      if (part.type !== 'tool-result' || part.output.type !== 'text') return part
      return {
        ...part,
        output: { ...part.output, value: compactToolText(part.output.value, part.toolName === 'exec') },
      }
    }),
  } as ModelMessage
}
