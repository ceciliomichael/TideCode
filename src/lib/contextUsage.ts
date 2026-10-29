import type { ModelMessage } from 'ai'
import type { Message } from '../types/chat'
import { extractHiddenUserContexts } from './hiddenUserContext'

export function approximateTokenCount(value: string) {
  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? Math.ceil(trimmedValue.length / 4) : 0
}

/** Generic heuristic, not a provider-specific image token count. */
export const MODEL_IMAGE_TOKEN_ALLOWANCE = 4_096

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
    seen.delete(value)
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
      Object.entries(record).filter(([key]) => !['image', 'data', 'providerOptions', 'providerMetadata'].includes(key)),
    )
    seen.delete(value)
    return {
      imageCount: 1,
      value: { ...metadata, payload: '[image payload]' },
    }
  }

  let imageCount = 0
  const isModelPart = ['text', 'reasoning', 'tool-call', 'tool-result', 'file'].includes(String(record.type))
  const entries = Object.entries(record).filter(([key]) => !isModelPart || !['providerOptions', 'providerMetadata'].includes(key))
  const sanitizedEntries = entries.map(([key, entryValue]) => {
    const sanitized = sanitizeModelContentForTokenEstimate(entryValue, seen)
    imageCount += sanitized.imageCount
    return [key, sanitized.value]
  })
  seen.delete(value)
  return { imageCount, value: Object.fromEntries(sanitizedEntries) }
}

/** Stable request identity without binary payloads or opaque provider metadata. */
export function serializeModelContentForEstimate(content: unknown) {
  return JSON.stringify(sanitizeModelContentForTokenEstimate(content, new WeakSet()).value)
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

export function estimateModelImageTokens(content: unknown) {
  return sanitizeModelContentForTokenEstimate(content, new WeakSet()).imageCount * MODEL_IMAGE_TOKEN_ALLOWANCE
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
      } else if (attachment.kind === 'image') {
        // Image tokenization is provider- and resolution-dependent. A stable
        // allowance is more useful than counting the much larger base64 string.
        historyTokens += MODEL_IMAGE_TOKEN_ALLOWANCE
        if (attachment.path) {
          historyTokens += approximateTokenCount(`Attached image: ${attachment.path}`)
        }
      } else {
        historyTokens += approximateTokenCount(`Attached ${attachment.kind}: ${attachment.path}`)
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

function getModelTextParts(content: unknown) {
  if (typeof content === 'string') {
    return [content]
  }

  if (!Array.isArray(content)) {
    return []
  }

  return content.flatMap((part) => {
    if (
      typeof part !== 'object'
      || part === null
      || !('type' in part)
      || part.type !== 'text'
      || !('text' in part)
      || typeof part.text !== 'string'
    ) {
      return []
    }

    return [part.text]
  })
}

function estimateInjectedContextTokens(content: unknown) {
  const hiddenContexts = getModelTextParts(content)
    .flatMap((text) => extractHiddenUserContexts(text))

  if (hiddenContexts.length === 0) {
    return 0
  }

  return estimateModelContentTokens(hiddenContexts.map((context) => context.content).join('\n\n'))
}

export function estimateModelMessageContextUsage(messages: readonly ModelMessage[]) {
  let historyTokens = 0
  let injectionTokens = 0
  let toolResultsTokens = 0
  let imageTokens = 0

  for (const message of messages) {
    const messageImageTokens = estimateModelImageTokens(message.content)
    imageTokens += messageImageTokens
    const messageTokens = estimateModelContentTokens(message.content) - messageImageTokens
    if (message.role === 'tool') {
      toolResultsTokens += messageTokens
      continue
    }

    let messageHistoryTokens = messageTokens
    let messageToolResultsTokens = 0
    if (message.role === 'user' && typeof message.content === 'string') {
      const migratedUsage = estimateMigratedToolResultUsage(message.content, messageTokens)
      messageHistoryTokens = migratedUsage.historyTokens
      messageToolResultsTokens = migratedUsage.toolResultsTokens
    }

    const messageInjectionTokens = message.role === 'user'
      ? Math.min(messageHistoryTokens, estimateInjectedContextTokens(message.content))
      : 0
    historyTokens += messageHistoryTokens - messageInjectionTokens
    injectionTokens += messageInjectionTokens
    toolResultsTokens += messageToolResultsTokens
  }

  return {
    historyTokens,
    imageTokens,
    injectionTokens,
    toolResultsTokens,
    totalTokens: historyTokens + injectionTokens + toolResultsTokens + imageTokens,
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
