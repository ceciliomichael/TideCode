import type { ModelMessage } from 'ai'

export const TOOL_OUTPUT_MAX_BYTES = 50 * 1024
export const TOOL_OUTPUT_MAX_LINES = 2_000
export const TOOL_OUTPUT_MAX_LINE_LENGTH = 2_000

const TOOL_OUTPUT_PREVIEW_RESERVE_BYTES = 1_024

export interface ToolOutputProjection {
  omittedBytes: number
  omittedLines: number
  text: string
  truncated: boolean
}

function byteLength(value: string) {
  return Buffer.byteLength(value, 'utf8')
}

function splitLines(value: string) {
  return value.split(/\r\n|\n|\r/u)
}

function truncateLine(value: string) {
  return value.length > TOOL_OUTPUT_MAX_LINE_LENGTH
    ? `${value.slice(0, TOOL_OUTPUT_MAX_LINE_LENGTH)}... (line truncated)`
    : value
}

function buildRecoveryHint(outputId?: string) {
  if (outputId) {
    return `Full output saved as ${outputId}. Use read_tool_output with output_id "${outputId}" and offset/limit to inspect more.`
  }

  return 'Use the tool again with a narrower path, pattern, offset, or limit to inspect more.'
}

export function projectToolOutputForModel(value: string, outputId?: string): ToolOutputProjection {
  const sourceLines = splitLines(value)
  const sourceBytes = byteLength(value)
  const hasLongLine = sourceLines.some((line) => line.length > TOOL_OUTPUT_MAX_LINE_LENGTH)
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

  const previewBudget = TOOL_OUTPUT_MAX_BYTES - TOOL_OUTPUT_PREVIEW_RESERVE_BYTES
  const visibleLines: string[] = []
  let previewBytes = 0

  for (const sourceLine of sourceLines) {
    if (visibleLines.length >= TOOL_OUTPUT_MAX_LINES) break

    const line = truncateLine(sourceLine)
    const separatorBytes = visibleLines.length > 0 ? 1 : 0
    const lineBytes = byteLength(line) + separatorBytes
    if (previewBytes + lineBytes > previewBudget) break

    visibleLines.push(line)
    previewBytes += lineBytes
  }

  if (visibleLines.length === 0 && sourceLines.length > 0) {
    visibleLines.push(truncateLine(sourceLines[0]))
  }

  const omittedLines = Math.max(0, sourceLines.length - visibleLines.length)
  const preview = visibleLines.join('\n')
  const omittedBytes = Math.max(0, sourceBytes - byteLength(preview))
  const notice = [
    '',
    `[Tool output truncated: showing ${visibleLines.length} of ${sourceLines.length} lines; approximately ${omittedBytes} bytes omitted.]`,
    buildRecoveryHint(outputId),
  ].join('\n')

  return {
    omittedBytes,
    omittedLines,
    text: `${preview}${notice}`,
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
