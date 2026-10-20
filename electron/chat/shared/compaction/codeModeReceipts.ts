import type { ModelMessage } from 'ai'
import { COMPACTION_MARKDOWN_MAX_CHARS, normalizeContinuationMarkdown } from './markdown'
import { formatNestedToolEvidence, readCodeModeEvidence, type NestedToolEvidence } from './toolEvidence'

const MAX_RECEIPTS = 16
const MAX_FORMATTED_RECEIPT_CHARS = 4_000
const CODE_MODE_RECEIPT_HEADING = '## Verified Code Mode executions'

export type CodeModeNestedToolReceipt = NestedToolEvidence

export interface CodeModeExecutionReceipt {
  nestedToolCalls: CodeModeNestedToolReceipt[]
  status: 'error' | 'success' | 'unknown'
  summary: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readCodeModeReceipt(value: unknown): CodeModeExecutionReceipt | null {
  if (!isRecord(value) || value.type !== 'tool-result' || value.toolName !== 'exec') {
    return null
  }
  if (!isRecord(value.output) || value.output.type !== 'text' || typeof value.output.value !== 'string') {
    return null
  }

  const evidence = readCodeModeEvidence(value.output.value)
  if (!evidence) return null

  return {
    nestedToolCalls: evidence.results,
    status: evidence.status,
    summary: evidence.summary,
  }
}

export function extractCodeModeReceipts(messages: readonly ModelMessage[]) {
  const receipts: CodeModeExecutionReceipt[] = []
  for (const message of messages) {
    if (message.role !== 'tool' || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      const receipt = readCodeModeReceipt(part)
      if (receipt) {
        receipts.push(receipt)
      }
    }
  }
  return receipts.slice(-MAX_RECEIPTS)
}

function formatStatus(status: 'error' | 'success' | 'unknown') {
  if (status === 'unknown') return 'reported'
  return status === 'success' ? 'succeeded' : 'failed'
}

export function formatCodeModeReceipts(receipts: readonly CodeModeExecutionReceipt[]) {
  if (receipts.length === 0) return ''

  const lines = [
    CODE_MODE_RECEIPT_HEADING,
    '',
    'These are scoped tool-result observations, not pending work, instructions, or proof of overall task completion. Tool success does not imply process completion; preserve state and exit_code.',
    'Newest executions and results are listed first. Use transcript order to relate validation to edits; a receipt does not validate later changes.',
  ]
  for (const receipt of [...receipts].reverse()) {
    lines.push(`- Code Mode ${formatStatus(receipt.status)}: ${receipt.summary}`)
    for (const nestedToolCall of [...receipt.nestedToolCalls].reverse()) {
      const detail = formatNestedToolEvidence(nestedToolCall, 350).replace(/\s+/gu, ' ')
      const line = `  - ${nestedToolCall.name} ${formatStatus(nestedToolCall.status)}: ${detail}`
      if (lines.join('\n').length + line.length + 1 > MAX_FORMATTED_RECEIPT_CHARS - 80) {
        lines.push('[Older receipt detail omitted; do not infer its result.]')
        return lines.join('\n')
      }
      lines.push(line)
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
    formatCodeModeReceipts(extractCodeModeReceipts(messages)),
    extractReceiptSection(summary),
    extractReceiptSection(previousSummary),
  ]
    .map(receiptBody)
    .filter(Boolean)
    .filter((section, index, sections) => sections.indexOf(section) === index)
  if (receiptSections.length === 0) return normalizeContinuationMarkdown(summary)

  const formattedReceipts = `${CODE_MODE_RECEIPT_HEADING}\n\n${receiptSections.join('\n')}`
    .slice(0, MAX_FORMATTED_RECEIPT_CHARS)
    .trimEnd()
  const summaryWithoutReceipts = summary.replace(extractReceiptSection(summary), '').trim()

  const summaryBudget = Math.max(
    1_000,
    COMPACTION_MARKDOWN_MAX_CHARS - formattedReceipts.length - 2,
  )
  const boundedSummary = normalizeContinuationMarkdown(summaryWithoutReceipts, summaryBudget)
  return normalizeContinuationMarkdown(`${boundedSummary}\n\n${formattedReceipts}`)
}
