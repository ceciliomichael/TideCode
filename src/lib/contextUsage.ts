import type { ModelMessage } from 'ai'
import type { Message } from '../types/chat'

export function approximateTokenCount(value: string) {
  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? Math.ceil(trimmedValue.length / 4) : 0
}

export const MODEL_IMAGE_TOKEN_ALLOWANCE = 1_024

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
    } else {
      historyTokens += messageTokens
    }
  }

  return {
    historyTokens,
    toolResultsTokens,
    totalTokens: historyTokens + toolResultsTokens,
  }
}
