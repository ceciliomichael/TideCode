import type { ModelMessage } from 'ai'

export const TOOL_OUTPUT_DEFAULT_MAX_TOKENS = 10_000
export const TOOL_OUTPUT_APPROXIMATE_BYTES_PER_TOKEN = 4
export const TOOL_OUTPUT_MAX_BYTES =
  TOOL_OUTPUT_DEFAULT_MAX_TOKENS * TOOL_OUTPUT_APPROXIMATE_BYTES_PER_TOKEN
export const TOOL_OUTPUT_MAX_LINES = 2_000
export const TOOL_OUTPUT_MAX_LINE_LENGTH = 2_000

const TOOL_OUTPUT_PREVIEW_RESERVE_BYTES = 2_048
const TOOL_OUTPUT_NOTICE_LINES = 2
const TOOL_OUTPUT_MODEL_WRAPPER_RESERVE_LINES = 8

export interface ToolOutputVisibleRange {
  endLine: number
  startLine: number
}

export interface ToolOutputProjection {
  omittedBytes: number
  omittedLines: number
  originalApproximateTokens?: number
  text: string
  totalLines?: number
  truncated: boolean
  visibleRanges?: ToolOutputVisibleRange[]
}

interface VisibleLine {
  lineNumber: number
  text: string
}

function byteLength(value: string) {
  return Buffer.byteLength(value, 'utf8')
}

function splitLines(value: string) {
  return value.split(/\r\n|\n|\r/u)
}

function truncateLine(value: string) {
  const characters = Array.from(value)
  if (characters.length <= TOOL_OUTPUT_MAX_LINE_LENGTH) return value

  const marker = '... (middle of line truncated) ...'
  const visibleCharacterBudget = Math.max(0, TOOL_OUTPUT_MAX_LINE_LENGTH - marker.length)
  const headLength = Math.floor(visibleCharacterBudget / 2)
  const tailLength = visibleCharacterBudget - headLength
  return `${characters.slice(0, headLength).join('')}${marker}${characters.slice(-tailLength).join('')}`
}

function collectHeadLines(sourceLines: readonly string[], maxLines: number, maxBytes: number) {
  const visibleLines: VisibleLine[] = []
  let usedBytes = 0

  for (let index = 0; index < sourceLines.length && visibleLines.length < maxLines; index += 1) {
    const text = truncateLine(sourceLines[index])
    const lineBytes = byteLength(text) + (visibleLines.length > 0 ? 1 : 0)
    if (usedBytes + lineBytes > maxBytes) break
    visibleLines.push({ lineNumber: index + 1, text })
    usedBytes += lineBytes
  }

  return visibleLines
}

function collectTailLines(
  sourceLines: readonly string[],
  firstAllowedIndex: number,
  maxLines: number,
  maxBytes: number,
) {
  const reversedLines: VisibleLine[] = []
  let usedBytes = 0

  for (
    let index = sourceLines.length - 1;
    index >= firstAllowedIndex && reversedLines.length < maxLines;
    index -= 1
  ) {
    const text = truncateLine(sourceLines[index])
    const lineBytes = byteLength(text) + (reversedLines.length > 0 ? 1 : 0)
    if (usedBytes + lineBytes > maxBytes) break
    reversedLines.push({ lineNumber: index + 1, text })
    usedBytes += lineBytes
  }

  return reversedLines.reverse()
}

function buildVisibleRanges(lines: readonly VisibleLine[]): ToolOutputVisibleRange[] {
  const ranges: ToolOutputVisibleRange[] = []
  for (const line of lines) {
    const previousRange = ranges[ranges.length - 1]
    if (previousRange && previousRange.endLine + 1 === line.lineNumber) {
      previousRange.endLine = line.lineNumber
      continue
    }
    ranges.push({ endLine: line.lineNumber, startLine: line.lineNumber })
  }
  return ranges
}

function formatVisibleRanges(ranges: readonly ToolOutputVisibleRange[]) {
  return ranges
    .map((range) => range.startLine === range.endLine
      ? `line ${range.startLine}`
      : `lines ${range.startLine}-${range.endLine}`)
    .join(' and ')
}

function buildRecoveryHint(outputId?: string) {
  if (outputId) {
    return `Full output reference: ${outputId}. Use read_tool_output with this output_id and a narrow offset/limit only if omitted content is needed.`
  }

  return 'Use the original tool again with a narrower path, pattern, offset, or limit only if omitted content is needed.'
}

export function projectToolOutputForModel(value: string, outputId?: string): ToolOutputProjection {
  const sourceLines = splitLines(value)
  const sourceBytes = byteLength(value)
  const hasLongLine = sourceLines.some((line) => Array.from(line).length > TOOL_OUTPUT_MAX_LINE_LENGTH)
  const needsTruncation =
    sourceBytes > TOOL_OUTPUT_MAX_BYTES ||
    sourceLines.length > TOOL_OUTPUT_MAX_LINES ||
    hasLongLine

  if (!needsTruncation) {
    return {
      omittedBytes: 0,
      omittedLines: 0,
      text: value,
      truncated: false,
    }
  }

  const previewBudget = Math.max(0, TOOL_OUTPUT_MAX_BYTES - TOOL_OUTPUT_PREVIEW_RESERVE_BYTES)
  const visibleLineBudget = Math.max(
    0,
    TOOL_OUTPUT_MAX_LINES - TOOL_OUTPUT_NOTICE_LINES - TOOL_OUTPUT_MODEL_WRAPPER_RESERVE_LINES,
  )
  const headLineBudget = Math.ceil(visibleLineBudget / 2)
  const tailLineBudget = visibleLineBudget - headLineBudget
  const headByteBudget = Math.floor(previewBudget / 2)
  const tailByteBudget = previewBudget - headByteBudget
  const headLines = collectHeadLines(sourceLines, headLineBudget, headByteBudget)
  const tailLines = collectTailLines(
    sourceLines,
    headLines.at(-1)?.lineNumber ?? 0,
    tailLineBudget,
    tailByteBudget,
  )
  const visibleLines = [...headLines, ...tailLines]
  const visibleRanges = buildVisibleRanges(visibleLines)
  const preview = visibleLines.map((line) => line.text).join('\n')
  const omittedBytes = Math.max(0, sourceBytes - byteLength(preview))
  const omittedLines = Math.max(0, sourceLines.length - visibleLines.length)
  const originalApproximateTokens = Math.ceil(sourceBytes / TOOL_OUTPUT_APPROXIMATE_BYTES_PER_TOKEN)
  const rangeSummary = visibleRanges.length > 0
    ? ` showing ${formatVisibleRanges(visibleRanges)} of ${sourceLines.length}`
    : ` from ${sourceLines.length} total lines`
  const notice = [
    `[Tool output truncated:${rangeSummary}; approximately ${omittedBytes} bytes omitted; original approximately ${originalApproximateTokens} tokens.]`,
    buildRecoveryHint(outputId),
  ].join('\n')

  const headText = headLines.map((line) => line.text).join('\n')
  const tailText = tailLines.map((line) => line.text).join('\n')
  const text = [headText, notice, tailText].filter((section) => section.length > 0).join('\n')

  return {
    omittedBytes,
    omittedLines,
    originalApproximateTokens,
    text,
    totalLines: sourceLines.length,
    truncated: true,
    visibleRanges,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function projectModelMessagesForContext(messages: readonly ModelMessage[]) {
  return messages.map((message) => {
    if (message.role !== 'tool' || !Array.isArray(message.content)) {
      return message
    }

    const content = message.content as readonly unknown[]
    return {
      ...message,
      content: content.map((part) => {
        if (!isRecord(part) || part.type !== 'tool-result' || !isRecord(part.output)) {
          return part
        }

        if (part.output.type !== 'text' || typeof part.output.value !== 'string') {
          return part
        }

        return {
          ...part,
          output: {
            ...part.output,
            value: projectToolOutputForModel(part.output.value).text,
          },
        }
      }),
    } as ModelMessage
  })
}
