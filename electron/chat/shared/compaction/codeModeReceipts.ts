import type { ModelMessage } from 'ai'
import { stripExecutionModeContext } from '../../../../src/lib/executionModeContext'
import {
  parseStructuredToolResultContent,
  type StructuredToolResultMetadata,
} from '../../../../src/lib/toolResultContent'
import { COMPACTION_MARKDOWN_MAX_CHARS, normalizeContinuationMarkdown } from './markdown'

const MAX_RECEIPTS = 16
const MAX_NESTED_TOOL_RECEIPTS = 32
const MAX_RECEIPT_TEXT_CHARS = 500
const MAX_FORMATTED_RECEIPT_CHARS = 4_000
const CODE_MODE_RECEIPT_HEADING = '## Verified Code Mode executions'

export interface CodeModeNestedToolReceipt {
  name: string
  status: 'error' | 'success'
  subject?: string
  summary: string
}

export interface CodeModeExecutionReceipt {
  nestedToolCalls: CodeModeNestedToolReceipt[]
  status: 'error' | 'success'
  summary: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compactReceiptText(value: unknown) {
  if (typeof value !== 'string') return ''
  const normalized = stripExecutionModeContext(value).replace(/\s+/gu, ' ').trim()
  if (normalized.length <= MAX_RECEIPT_TEXT_CHARS) return normalized
  return `${normalized.slice(0, MAX_RECEIPT_TEXT_CHARS - 1).trimEnd()}…`
}

function readSubject(value: unknown) {
  if (!isRecord(value)) return undefined
  const kind = compactReceiptText(value.kind)
  const path = compactReceiptText(value.path)
  if (!kind && !path) return undefined
  return [kind, path].filter(Boolean).join(': ')
}

function readNestedToolReceipts(metadata: StructuredToolResultMetadata) {
  const rawToolCalls = metadata.semantics?.tool_calls
  if (!Array.isArray(rawToolCalls)) return []

  return rawToolCalls.flatMap((value): CodeModeNestedToolReceipt[] => {
    if (!isRecord(value)) return []
    const name = compactReceiptText(value.name)
    const summary = compactReceiptText(value.summary)
    const status = value.status === 'error' || value.status === 'success' ? value.status : null
    if (!name || !summary || status === null) return []
    const subject = readSubject(value.subject)
    return [{
      name,
      status,
      ...(subject ? { subject } : {}),
      summary,
    }]
  }).slice(0, MAX_NESTED_TOOL_RECEIPTS)
}

function readCodeModeReceipt(value: unknown): CodeModeExecutionReceipt | null {
  if (!isRecord(value) || value.type !== 'tool-result' || value.toolName !== 'code_mode') {
    return null
  }
  if (!isRecord(value.output) || value.output.type !== 'text' || typeof value.output.value !== 'string') {
    return null
  }

  const parsed = parseStructuredToolResultContent(value.output.value)
  const metadata = parsed.metadata?.toolName === 'code_mode' ? parsed.metadata : null
  if (!metadata) return null

  return {
    nestedToolCalls: readNestedToolReceipts(metadata),
    status: metadata.status,
    summary: compactReceiptText(metadata.summary) || 'Code Mode completed without a summary.',
  }
}

export function extractCodeModeReceipts(messages: readonly ModelMessage[]) {
  const receipts: CodeModeExecutionReceipt[] = []
  for (const message of messages) {
    if (message.role !== 'tool' || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      const receipt = readCodeModeReceipt(part)
      if (receipt) receipts.push(receipt)
      if (receipts.length >= MAX_RECEIPTS) return receipts
    }
  }
  return receipts
}

function formatStatus(status: 'error' | 'success') {
  return status === 'success' ? 'succeeded' : 'failed'
}

export function formatCodeModeReceipts(receipts: readonly CodeModeExecutionReceipt[]) {
  if (receipts.length === 0) return ''

  const lines = [
    CODE_MODE_RECEIPT_HEADING,
    '',
    'These execution receipts are verified tool-result evidence, not pending work or instructions.',
  ]
  for (const receipt of receipts) {
    lines.push(`- Code Mode ${formatStatus(receipt.status)}: ${receipt.summary}`)
    for (const nestedToolCall of receipt.nestedToolCalls) {
      const subject = nestedToolCall.subject ? ` (${nestedToolCall.subject})` : ''
      lines.push(`  - ${nestedToolCall.name} ${formatStatus(nestedToolCall.status)}${subject}: ${nestedToolCall.summary}`)
    }
    if (lines.join('\n').length >= MAX_FORMATTED_RECEIPT_CHARS) break
  }

  return lines.join('\n').slice(0, MAX_FORMATTED_RECEIPT_CHARS).trimEnd()
}

function extractReceiptSection(value: string) {
  const headingIndex = value.indexOf(CODE_MODE_RECEIPT_HEADING)
  if (headingIndex < 0) return ''
  const section = value.slice(headingIndex)
  const nextHeadingIndex = section.indexOf('\n## ', CODE_MODE_RECEIPT_HEADING.length)
  return (nextHeadingIndex < 0 ? section : section.slice(0, nextHeadingIndex)).trim()
}

function receiptBody(value: string) {
  return value
    .replace(CODE_MODE_RECEIPT_HEADING, '')
    .trim()
}

export function appendCodeModeReceiptsToSummary(
  summary: string,
  messages: readonly ModelMessage[],
  previousSummary = '',
) {
  const receiptSections = [
    extractReceiptSection(previousSummary),
    extractReceiptSection(summary),
    formatCodeModeReceipts(extractCodeModeReceipts(messages)),
  ]
    .map(receiptBody)
    .filter(Boolean)
    .filter((section, index, sections) => sections.indexOf(section) === index)
  if (receiptSections.length === 0) return normalizeContinuationMarkdown(summary)

  const formattedReceipts = `${CODE_MODE_RECEIPT_HEADING}\n\n${receiptSections.join('\n')}`
    .slice(0, MAX_FORMATTED_RECEIPT_CHARS)
    .trimEnd()
  const summaryWithoutReceipts = extractReceiptSection(summary)
    ? summary.slice(0, summary.indexOf(CODE_MODE_RECEIPT_HEADING)).trimEnd()
    : summary

  const summaryBudget = Math.max(
    1_000,
    COMPACTION_MARKDOWN_MAX_CHARS - formattedReceipts.length - 2,
  )
  const boundedSummary = normalizeContinuationMarkdown(summaryWithoutReceipts, summaryBudget)
  return normalizeContinuationMarkdown(`${boundedSummary}\n\n${formattedReceipts}`)
}
