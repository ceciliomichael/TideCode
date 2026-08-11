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

function appendSection(lines: string[], heading: string, values: readonly string[], emptyText?: string) {
  const normalizedValues = values.map((value) => value.trim()).filter(Boolean)
  if (normalizedValues.length === 0 && !emptyText) return
  lines.push(heading, '')
  if (normalizedValues.length > 0) normalizedValues.forEach((value) => lines.push(`- ${value}`))
  else lines.push(emptyText as string)
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
  const lines: string[] = []

  appendSection(lines, '## What happened', packet.goal)
  appendSection(lines, '## Constraints', packet.constraints)
  appendSection(lines, '## Current state', packet.currentState)
  appendSection(lines, '## Completed work', packet.completedWork, 'No completed work was recorded in the compacted range.')
  appendSection(lines, '## Important decisions and reasoning', packet.decisions)

  if (packet.reasoningContinuity.length > 0) {
    lines.push('Visible action-linked reasoning:')
    packet.reasoningContinuity.forEach((entry) => lines.push(renderReasoningEntry(entry)))
    lines.push('')
  }

  appendSection(lines, '## Evidence and files', [
    ...packet.failuresAndWorkarounds,
    ...packet.filesAndSymbols.map(renderFileReference),
    ...packet.toolObservations.map((observation) => (
      `${observation.subject} was ${observation.status}: ${observation.fact}`
    )),
  ])
  appendSection(lines, '## Validation', packet.validation)
  appendSection(lines, '## Plan state', packet.planState)
  appendSection(lines, '## Remaining work', packet.openItems, 'No unfinished work is currently recorded.')
  appendSection(lines, '## Next actions', packet.nextActions)
  appendSection(lines, '## Unverified or omitted details', packet.omitted)

  return normalizeContinuationMarkdown(lines.join('\n'))
}
