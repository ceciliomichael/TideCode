import type { ModelMessage } from 'ai'
import type { Message } from '../types/chat'

export function approximateTokenCount(value: string) {
  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? Math.ceil(trimmedValue.length / 4) : 0
}

export const MODEL_IMAGE_TOKEN_ALLOWANCE = 1_024

const MIGRATED_TOOL_EXCHANGE_MARKER = 'Previous tool exchange from another provider:'
const MIGRATED_TOOL_RESULT_MARKER = 'Previous tool result:'
const MIGRATED_TOOL_RESULT_SEPARATOR = '\nResult:\n'

interface SanitizedModelContent {
  imageCount: number
  value: unknown
}

function sanitizeModelContentForTokenEstimate(value: unknown, seen: WeakSet<object>): SanitizedModelContent {
  if (typeof value !== 'object' || value === null) {
    return { imageCount: 0, value }
  }
  if (seen.has(value)) {
    return { imageCount: 0, value: '[circular]' }
  }
  seen.add(value)

  if (Array.isArray(value)) {
    let imageCount = 0
    const sanitizedItems = value.map((item) => {
      const sanitized = sanitizeModelContentForTokenEstimate(item, seen)
      imageCount += sanitized.imageCount
      return sanitized.value
    })
    return { imageCount, value: sanitizedItems }
  }

  const record = value as Record<string, unknown>
  const isImagePart = record.type === 'image'
  const isImageFilePart =
    record.type === 'file' &&
    typeof record.mediaType === 'string' &&
    (record.mediaType === 'image' || record.mediaType.startsWith('image/'))
  if (isImagePart || isImageFilePart) {
    const metadata = Object.fromEntries(
      Object.entries(record).filter(([key]) => key !== 'image' && key !== 'data'),
    )
    return {
      imageCount: 1,
      value: { ...metadata, payload: '[image payload]' },
    }
  }

  let imageCount = 0
  const sanitizedEntries = Object.entries(record).map(([key, entryValue]) => {
    const sanitized = sanitizeModelContentForTokenEstimate(entryValue, seen)
    imageCount += sanitized.imageCount
    return [key, sanitized.value]
  })
  return { imageCount, value: Object.fromEntries(sanitizedEntries) }
}

export function estimateModelContentTokens(content: unknown) {
  const sanitized = sanitizeModelContentForTokenEstimate(content, new WeakSet())
  let serialized = ''
  try {
    serialized = JSON.stringify(sanitized.value)
  } catch {
    serialized = ''
  }
  return approximateTokenCount(serialized) + sanitized.imageCount * MODEL_IMAGE_TOKEN_ALLOWANCE
}

export function estimateMessageContextUsage(messages: readonly Message[]) {
  let historyTokens = 0
  let toolResultsTokens = 0

  for (const message of messages) {
    if (message.role === 'tool') {
      toolResultsTokens += approximateTokenCount(message.content)
      continue
    }

    historyTokens += approximateTokenCount(message.content)
    historyTokens += approximateTokenCount(message.reasoningContent ?? '')

    for (const attachment of message.attachments ?? []) {
      if (attachment.kind === 'text') {
        historyTokens += approximateTokenCount(`Attachment ${attachment.fileName}:\n${attachment.textContent}`)
      } else {
        // Image tokenization is provider- and resolution-dependent. A stable
        // allowance is more useful than counting the much larger base64 string.
        historyTokens += MODEL_IMAGE_TOKEN_ALLOWANCE
      }
    }

    for (const invocation of message.toolInvocations ?? []) {
      if (invocation.state !== 'running') {
        historyTokens += approximateTokenCount(invocation.argumentsText)
      }
    }
  }

  return {
    historyTokens,
    toolResultsTokens,
    totalTokens: historyTokens + toolResultsTokens,
  }
}

export function estimateModelMessageContextUsage(messages: readonly ModelMessage[]) {
  let historyTokens = 0
  let toolResultsTokens = 0

  for (const message of messages) {
    const messageTokens = estimateModelContentTokens(message.content)
    if (message.role === 'tool') {
      toolResultsTokens += messageTokens
      continue
    }

    if (message.role === 'user' && typeof message.content === 'string') {
      const migratedUsage = estimateMigratedToolResultUsage(message.content, messageTokens)
      historyTokens += migratedUsage.historyTokens
      toolResultsTokens += migratedUsage.toolResultsTokens
      continue
    }

    historyTokens += messageTokens
  }

  return {
    historyTokens,
    toolResultsTokens,
    totalTokens: historyTokens + toolResultsTokens,
  }
}

interface MigratedToolResultSection {
  contentEnd: number
  resultStart: number
}

function findNextMigratedToolMarker(content: string, offset: number) {
  const exchangeIndex = content.indexOf(MIGRATED_TOOL_EXCHANGE_MARKER, offset)
  const resultIndex = content.indexOf(MIGRATED_TOOL_RESULT_MARKER, offset)
  if (exchangeIndex < 0) return resultIndex
  if (resultIndex < 0) return exchangeIndex
  return Math.min(exchangeIndex, resultIndex)
}

function findMigratedToolResultSections(content: string) {
  const sections: MigratedToolResultSection[] = []
  let markerStart = findNextMigratedToolMarker(content, 0)

  while (markerStart >= 0) {
    const nextMarkerStart = findNextMigratedToolMarker(content, markerStart + 1)
    const contentEnd = nextMarkerStart >= 0 ? nextMarkerStart : content.length
    const isExchange = content.startsWith(MIGRATED_TOOL_EXCHANGE_MARKER, markerStart)
    const resultStart = isExchange
      ? content.indexOf(MIGRATED_TOOL_RESULT_SEPARATOR, markerStart + MIGRATED_TOOL_EXCHANGE_MARKER.length)
      : markerStart + MIGRATED_TOOL_RESULT_MARKER.length

    if (resultStart >= 0 && resultStart < contentEnd) {
      sections.push({
        contentEnd,
        resultStart: isExchange ? resultStart + MIGRATED_TOOL_RESULT_SEPARATOR.length : resultStart,
      })
    }

    if (nextMarkerStart < 0) break
    markerStart = nextMarkerStart
  }

  return sections
}

/**
 * Cross-provider replay cannot retain native tool-role messages, so it embeds
 * prior tool exchanges in user text. Split only the exact migration format and
 * preserve the original aggregate estimate while attributing result bodies to
 * the Tool results row in the context indicator.
 */
function estimateMigratedToolResultUsage(content: string, messageTokens: number) {
  const sections = findMigratedToolResultSections(content)
  if (sections.length === 0 || messageTokens === 0) {
    return { historyTokens: messageTokens, toolResultsTokens: 0 }
  }

  const toolResultText = sections
    .map(({ contentEnd, resultStart }) => content.slice(resultStart, contentEnd))
    .join('\n')
  const historyTextParts: string[] = []
  let cursor = 0
  for (const { contentEnd, resultStart } of sections) {
    historyTextParts.push(content.slice(cursor, resultStart))
    cursor = contentEnd
  }
  historyTextParts.push(content.slice(cursor))

  const rawToolTokens = approximateTokenCount(toolResultText)
  const rawHistoryTokens = approximateTokenCount(historyTextParts.join('\n'))
  const rawTotalTokens = rawToolTokens + rawHistoryTokens
  if (rawToolTokens === 0 || rawTotalTokens === 0) {
    return { historyTokens: messageTokens, toolResultsTokens: 0 }
  }

  const toolResultsTokens = Math.min(
    messageTokens,
    Math.max(1, Math.round(messageTokens * rawToolTokens / rawTotalTokens)),
  )
  return {
    historyTokens: messageTokens - toolResultsTokens,
    toolResultsTokens,
  }
}
