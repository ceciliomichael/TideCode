import type { ModelMessage } from 'ai'
import { stripExecutionModeContext } from '../../../../src/lib/executionModeContext'
import type { LocalCompactionPacketV2 } from './contracts'

export const COMPACTION_MARKDOWN_MAX_CHARS = 32_000
export const COMPACTION_MARKDOWN_MAX_LINES = 480

const MAX_MARKDOWN_LINE_CHARS = 4_000

function stripReasoningMarkup(value: string) {
  return value
    .replace(/<think\b[^>]*>[\s\S]*?(?:<\/think\s*>|$)/giu, '')
    .replace(/<analysis\b[^>]*>[\s\S]*?(?:<\/analysis\s*>|$)/giu, '')
    .replace(/<reasoning\b[^>]*>[\s\S]*?(?:<\/reasoning\s*>|$)/giu, '')
}

function stripControlCharacters(value: string) {
  return Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return !(
        (codePoint >= 0 && codePoint <= 8) ||
        codePoint === 11 ||
        codePoint === 12 ||
        (codePoint >= 14 && codePoint <= 31) ||
        codePoint === 127
      )
    })
    .join('')
}

function isJsonObject(value: string) {
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false

  try {
    const parsed = JSON.parse(trimmed) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  } catch {
    return false
  }
}

function trimToMarkdownBoundary(value: string, maxCharacters: number) {
  if (value.length <= maxCharacters) return value
  const clipped = value.slice(0, maxCharacters - 1)
  const lastNewline = clipped.lastIndexOf('\n')
  const boundary = lastNewline >= Math.floor(maxCharacters * 0.6) ? clipped.slice(0, lastNewline) : clipped
  return `${boundary.trimEnd()}…`
}

export function normalizeContinuationMarkdown(value: string, maxCharacters = COMPACTION_MARKDOWN_MAX_CHARS) {
  const withoutUnsupportedState = stripExecutionModeContext(stripReasoningMarkup(value))
  if (isJsonObject(withoutUnsupportedState)) return ''

  const lines = stripControlCharacters(withoutUnsupportedState)
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.slice(0, MAX_MARKDOWN_LINE_CHARS).trimEnd())

  const normalizedLines: string[] = []
  let blankLineCount = 0
  for (const line of lines) {
    if (line.trim().length === 0) {
      blankLineCount += 1
      if (blankLineCount <= 2) normalizedLines.push('')
      continue
    }

    blankLineCount = 0
    normalizedLines.push(line)
    if (normalizedLines.length >= COMPACTION_MARKDOWN_MAX_LINES) break
  }

  return trimToMarkdownBoundary(normalizedLines.join('\n').trim(), maxCharacters)
}

export interface ContinuationMarkdownValidation {
  normalized: string
  valid: boolean
  reason: 'empty' | 'json' | 'meta_only' | 'valid'
}

export function validateContinuationMarkdown(value: string): ContinuationMarkdownValidation {
  const normalized = normalizeContinuationMarkdown(value)
  if (normalized.length === 0) {
    return { normalized, reason: value.trim().startsWith('{') ? 'json' : 'empty', valid: false }
  }

  const withoutMarkdownSyntax = normalized
    .replace(/[`*_>#\-[\]()]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase()
  const isMetaOnly = /^(?:acknowledged|acknowledgement|summary|context compressed|done|okay|ok|none)[.!\s]*$/u.test(
    withoutMarkdownSyntax,
  )
  if (isMetaOnly) {
    return { normalized, reason: 'meta_only', valid: false }
  }

  return { normalized, reason: 'valid', valid: true }
}

export function isCompactionContinuationMessage(message: ModelMessage, expectedMarkdown?: string) {
  if (message.role !== 'assistant' || typeof message.content !== 'string') return false
  if (!expectedMarkdown) return false
  return normalizeContinuationMarkdown(message.content) === normalizeContinuationMarkdown(expectedMarkdown)
}

export function buildContinuationMessage(markdown: string): ModelMessage {
  const validation = validateContinuationMarkdown(markdown)
  if (!validation.valid) {
    throw new Error(`Cannot build a compaction message from invalid Markdown: ${validation.reason}.`)
  }

  return {
    role: 'assistant',
    content: validation.normalized,
  }
}

function formatInlineCode(value: string) {
  const normalized = value.replace(/`/gu, '\\`').trim()
  return normalized.length > 0 ? `\`${normalized}\`` : ''
}

function appendNarrative(lines: string[], lead: string, values: readonly string[]) {
  const normalizedValues = values.map((value) => value.trim()).filter(Boolean)
  if (normalizedValues.length === 0) return
  if (normalizedValues.length === 1) {
    lines.push(`${lead} ${normalizedValues[0]}`)
  } else {
    lines.push(`${lead}`)
    normalizedValues.forEach((value) => lines.push(`- ${value}`))
  }
  lines.push('')
}

function renderFileReference(file: LocalCompactionPacketV2['filesAndSymbols'][number]) {
  const path = formatInlineCode(file.path) || file.path
  const symbols = file.symbols.length > 0 ? ` (${file.symbols.map(formatInlineCode).filter(Boolean).join(', ')})` : ''
  return `${path}${symbols} is ${file.status}; ${file.evidence}`
}

function renderReasoningEntry(entry: LocalCompactionPacketV2['reasoningContinuity'][number]) {
  const evidence = entry.evidence.length > 0 ? ` The evidence was ${entry.evidence.join(' ')}` : ''
  const nextCheck = entry.nextCheck ? ` The next check is ${entry.nextCheck}.` : ''
  return `Earlier, the agent ${entry.action} while ${entry.situation}, because ${entry.rationale}. The outcome was ${entry.outcome} with ${entry.confidence} confidence.${evidence}${nextCheck}`
}

export function buildContinuationMarkdownFromPacket(
  packet: Pick<
    LocalCompactionPacketV2,
    | 'goal'
    | 'constraints'
    | 'currentState'
    | 'completedWork'
    | 'decisions'
    | 'openItems'
    | 'failuresAndWorkarounds'
    | 'filesAndSymbols'
    | 'validation'
    | 'planState'
    | 'toolObservations'
    | 'nextActions'
    | 'omitted'
    | 'reasoningContinuity'
  >,
) {
  const lines: string[] = [
    'The compaction model did not provide a usable summary, so this continuation was reconstructed from verified conversation evidence.',
    '',
  ]

  appendNarrative(lines, 'The work is focused on', packet.goal)
  appendNarrative(lines, 'Keep these constraints in mind:', packet.constraints)
  appendNarrative(lines, 'The latest verified state is:', packet.currentState)
  appendNarrative(lines, 'The conversation confirms this completed work:', packet.completedWork)
  appendNarrative(lines, 'The prior approach and decisions were:', packet.decisions)

  if (packet.reasoningContinuity.length > 0) {
    lines.push('Earlier action-linked reasoning that was visible in the transcript:')
    packet.reasoningContinuity.forEach((entry) => lines.push(renderReasoningEntry(entry)))
    lines.push('')
  }

  appendNarrative(lines, 'Earlier attempts found:', packet.failuresAndWorkarounds)
  appendNarrative(lines, 'Relevant files and symbols include:', packet.filesAndSymbols.map(renderFileReference))
  appendNarrative(lines, 'The available tool evidence is:', packet.toolObservations.map((observation) => (
    `${observation.subject} was ${observation.status}: ${observation.fact}`
  )))
  appendNarrative(lines, 'Checks already completed include:', packet.validation)
  appendNarrative(lines, 'The remaining plan is:', packet.planState)
  appendNarrative(lines, 'The unfinished work is:', packet.openItems)
  appendNarrative(lines, 'Continue by:', packet.nextActions)
  appendNarrative(lines, 'Do not assume these details without further verification:', packet.omitted)

  return normalizeContinuationMarkdown(lines.join('\n'))
}
