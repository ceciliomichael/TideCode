import type { FilePart, ModelMessage } from 'ai'
import type { ToolResultOutput } from '@ai-sdk/provider-utils'
import { Buffer } from 'node:buffer'

const TOOL_VISUAL_CONTEXT_PREFIX = '[TideCode visual tool result]'

type ToolResultFilePart = {
  data: unknown
  filename?: string
  mediaType: string
  providerOptions?: unknown
  type: 'file'
}

interface NormalizedVisualPart {
  normalizedData: FilePart['data']
  visualPart: ToolResultFilePart
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isVisualFilePart(value: unknown): value is ToolResultFilePart {
  return isRecord(value)
    && value.type === 'file'
    && typeof value.mediaType === 'string'
    && value.mediaType.startsWith('image/')
    && isRecord(value.data)
}

function normalizeVisualFileDataForUserPrompt(value: unknown): FilePart['data'] | null {
  if (!isRecord(value) || value.type !== 'data' || !('data' in value)) {
    return null
  }
  const rawData = value.data
  if (typeof rawData === 'string') {
    return { type: 'data', data: rawData }
  }
  if (Buffer.isBuffer(rawData)) {
    return { type: 'data', data: rawData.toString('base64') }
  }
  if (rawData instanceof Uint8Array) {
    return { type: 'data', data: Buffer.from(rawData).toString('base64') }
  }
  if (rawData instanceof ArrayBuffer) {
    return { type: 'data', data: Buffer.from(rawData).toString('base64') }
  }
  return null
}

function collectNormalizedVisualParts(values: readonly unknown[]): NormalizedVisualPart[] {
  const result: NormalizedVisualPart[] = []
  for (const value of values) {
    if (!isVisualFilePart(value)) continue
    const normalizedData = normalizeVisualFileDataForUserPrompt(value.data)
    if (normalizedData === null) continue
    result.push({ normalizedData, visualPart: value })
  }
  return result
}

export function isEphemeralToolVisualMessage(message: ModelMessage) {
  return message.role === 'user'
    && Array.isArray(message.content)
    && message.content.some((part) => (
      isRecord(part)
      && part.type === 'text'
      && typeof part.text === 'string'
      && part.text.startsWith(TOOL_VISUAL_CONTEXT_PREFIX)
    ))
}

export function stripEphemeralToolVisualMessages(messages: readonly ModelMessage[]) {
  return messages.filter((message) => !isEphemeralToolVisualMessage(message))
}

export function stripVisualToolResultFiles(messages: readonly ModelMessage[]) {
  return stripEphemeralToolVisualMessages(
    externalizeVisualToolResultMessages(messages).messages,
  )
}

export function createEphemeralToolVisualMessages(outputs: readonly ToolResultOutput[]): ModelMessage[] {
  const messages: ModelMessage[] = []
  for (const output of outputs) {
    if (output.type !== 'content') continue
    const outputValues = output.value as readonly unknown[]
    const visualParts = collectNormalizedVisualParts(outputValues)
    if (visualParts.length === 0) continue
    const label = outputValues.find((part) => isRecord(part) && part.type === 'text' && typeof part.text === 'string')
    messages.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: `${TOOL_VISUAL_CONTEXT_PREFIX}${isRecord(label) && typeof label.text === 'string' && label.text.trim().length > 0 ? ` ${label.text}` : ''}`,
        },
        ...visualParts.map(({ normalizedData, visualPart }): FilePart => ({
          type: 'file',
          data: normalizedData,
          ...(typeof visualPart.filename === 'string' && visualPart.filename.length > 0
            ? { filename: visualPart.filename }
            : {}),
          mediaType: visualPart.mediaType,
        })),
      ],
    })
  }
  return messages
}

export function externalizeVisualToolResultMessages(messages: readonly ModelMessage[]): {
  changed: boolean
  messages: ModelMessage[]
} {
  let changed = false
  const projected: ModelMessage[] = []

  for (const message of messages) {
    if (message.role !== 'tool' || !Array.isArray(message.content)) {
      projected.push(message)
      continue
    }

    const visualMessages: ModelMessage[] = []
    const contentParts = message.content as unknown[]
    const sanitizedContent = contentParts.map((part) => {
      if (!isRecord(part) || part.type !== 'tool-result' || !isRecord(part.output)) {
        return part
      }
      const output = part.output
      if (output.type !== 'content' || !Array.isArray(output.value)) {
        return part
      }

      const visualParts = output.value
        .filter(isVisualFilePart)
        .map((visualPart) => ({
          visualPart,
          normalizedData: normalizeVisualFileDataForUserPrompt(visualPart.data),
        }))
        .filter((entry): entry is {
          normalizedData: FilePart['data']
          visualPart: ToolResultFilePart
        } => entry.normalizedData !== null)
      if (visualParts.length === 0) {
        return part
      }
      changed = true
      const nonVisualParts = output.value.filter((value: unknown) => {
        if (!isVisualFilePart(value)) return true
        return normalizeVisualFileDataForUserPrompt(value.data) === null
      })
      const toolName = typeof part.toolName === 'string' ? part.toolName : 'tool'
      const toolCallId = typeof part.toolCallId === 'string' ? part.toolCallId : 'unknown'
      const receiptText = `Visual output from ${toolName} (${toolCallId}) is supplied in the following image message.`

      visualMessages.push({
        role: 'user',
        content: [
          { type: 'text', text: `${TOOL_VISUAL_CONTEXT_PREFIX} ${toolName} (${toolCallId})` },
          ...visualParts.map(({ normalizedData, visualPart }): FilePart => ({
            type: 'file' as const,
            data: normalizedData,
            ...(typeof visualPart.filename === 'string' && visualPart.filename.length > 0
              ? { filename: visualPart.filename }
              : {}),
            mediaType: visualPart.mediaType,
            ...(visualPart.providerOptions
              ? { providerOptions: visualPart.providerOptions as FilePart['providerOptions'] }
              : {}),
          })),
        ],
      })

      return {
        ...part,
        output: nonVisualParts.length > 0
          ? { ...output, value: nonVisualParts }
          : { type: 'text' as const, value: receiptText },
      }
    })

    projected.push({ ...message, content: sanitizedContent } as ModelMessage)
    projected.push(...visualMessages)
  }

  return { changed, messages: projected }
}
