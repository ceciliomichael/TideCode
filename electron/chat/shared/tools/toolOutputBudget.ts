import type { ModelMessage } from 'ai'

export const TOOL_OUTPUT_DEFAULT_MAX_TOKENS = 10_000
export const TOOL_OUTPUT_APPROXIMATE_BYTES_PER_TOKEN = 4
export const TOOL_OUTPUT_MAX_BYTES =
  TOOL_OUTPUT_DEFAULT_MAX_TOKENS * TOOL_OUTPUT_APPROXIMATE_BYTES_PER_TOKEN
export const TOOL_OUTPUT_MAX_LINES = 2_000
export const TOOL_OUTPUT_MAX_LINE_LENGTH = 2_000
export const TOOL_OUTPUT_PAGED_READ_MAX_BYTES = 32 * 1024

const TOOL_OUTPUT_PREVIEW_RESERVE_BYTES = 2_048
const TOOL_OUTPUT_NOTICE_LINES = 2
const TOOL_OUTPUT_MODEL_WRAPPER_RESERVE_LINES = 8

export interface ToolOutputProjection {
  text: string
  truncated: boolean
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

function hasMoreThanCodePoints(value: string, maxCodePoints: number) {
  if (value.length <= maxCodePoints) return false
  let count = 0
  for (const character of value) {
    void character
    count += 1
    if (count > maxCodePoints) return true
  }
  return false
}

function truncateLine(value: string) {
  if (!hasMoreThanCodePoints(value, TOOL_OUTPUT_MAX_LINE_LENGTH)) return value

  const marker = '... (middle of line truncated) ...'
  const visibleCharacterBudget = Math.max(0, TOOL_OUTPUT_MAX_LINE_LENGTH - marker.length)
  const headLength = Math.floor(visibleCharacterBudget / 2)
  const tailLength = visibleCharacterBudget - headLength
  const head = Array.from(value.slice(0, headLength * 2)).slice(0, headLength).join('')
  const tailWindow = value.slice(Math.max(0, value.length - tailLength * 2))
  const tail = Array.from(tailWindow).slice(-tailLength).join('')
  return `${head}${marker}${tail}`
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

function buildRecoveryHint(outputId?: string) {
  if (outputId) {
    return `output_id: "${outputId}". Use read_tool_output with this output_id and a narrow offset/limit only if omitted content is needed.`
  }

  return 'Re-run the original tool with narrower arguments only if omitted content is needed.'
}

export function projectToolOutputForModel(value: string, outputId?: string): ToolOutputProjection {
  const sourceBytes = byteLength(value)
  const sourceLines = splitLines(value)
  const hasLongLine = sourceLines.some((line) => hasMoreThanCodePoints(line, TOOL_OUTPUT_MAX_LINE_LENGTH))
  const needsTruncation =
    sourceBytes > TOOL_OUTPUT_MAX_BYTES ||
    sourceLines.length > TOOL_OUTPUT_MAX_LINES ||
    hasLongLine

  if (!needsTruncation) {
    return {
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
  const omittedStartLine = (headLines.at(-1)?.lineNumber ?? 0) + 1
  const omittedEndLine = (tailLines[0]?.lineNumber ?? sourceLines.length + 1) - 1
  const omittedRange = omittedEndLine >= omittedStartLine
    ? ` Omitted lines ${omittedStartLine}-${omittedEndLine}.`
    : ''
  const notice = `[Output truncated.${omittedRange} ${buildRecoveryHint(outputId)}]`

  const headText = headLines.map((line) => line.text).join('\n')
  const tailText = tailLines.map((line) => line.text).join('\n')
  const text = [headText, notice, tailText].filter((section) => section.length > 0).join('\n')

  return {
    text,
    truncated: true,
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
