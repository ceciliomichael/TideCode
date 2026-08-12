import type { ModelMessage } from 'ai'
import { projectToolOutputForModel } from './tools/toolOutputBudget'

type MessagePart = Record<string, unknown>

function isMessagePart(value: unknown): value is MessagePart {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getMessageParts(message: ModelMessage): readonly unknown[] | null {
  const content = (message as { content?: unknown }).content
  return Array.isArray(content) ? content : null
}

function getToolCallId(part: unknown, expectedType: 'tool-call' | 'tool-result') {
  if (!isMessagePart(part) || part.type !== expectedType || typeof part.toolCallId !== 'string') {
    return null
  }

  return part.toolCallId
}

function collectImmediateToolResultIds(messages: readonly ModelMessage[], assistantIndex: number) {
  const resultIds = new Set<string>()

  for (let index = assistantIndex + 1; index < messages.length; index += 1) {
    const message = messages[index]
    if (message?.role !== 'tool') {
      break
    }

    for (const part of getMessageParts(message) ?? []) {
      const toolCallId = getToolCallId(part, 'tool-result')
      if (toolCallId) {
        resultIds.add(toolCallId)
      }
    }
  }

  return resultIds
}

function sanitizeAssistantMessage(message: ModelMessage, messageIndex: number, messages: readonly ModelMessage[]) {
  const parts = getMessageParts(message)
  if (!parts) {
    return {
      message,
      pendingToolCallIds: null,
    }
  }

  const immediateToolResultIds = collectImmediateToolResultIds(messages, messageIndex)
  const filteredParts = parts.filter((part) => {
    const toolCallId = getToolCallId(part, 'tool-call')
    return toolCallId === null || immediateToolResultIds.has(toolCallId)
  })

  if (filteredParts.length === 0) {
    return {
      message: null,
      pendingToolCallIds: null,
    }
  }

  const pendingToolCallIds = new Set<string>()
  for (const part of filteredParts) {
    const toolCallId = getToolCallId(part, 'tool-call')
    if (toolCallId) {
      pendingToolCallIds.add(toolCallId)
    }
  }

  return {
    message: {
      ...message,
      content: filteredParts,
    } as ModelMessage,
    pendingToolCallIds: pendingToolCallIds.size > 0 ? pendingToolCallIds : null,
  }
}

function sanitizeToolMessage(message: ModelMessage, pendingToolCallIds: Set<string> | null) {
  if (!pendingToolCallIds) {
    return {
      message: null,
      pendingToolCallIds,
    }
  }

  const parts = getMessageParts(message)
  if (!parts) {
    return {
      message: null,
      pendingToolCallIds,
    }
  }

  const consumedToolCallIds = new Set<string>()
  const filteredParts = parts.filter((part) => {
    const toolCallId = getToolCallId(part, 'tool-result')
    if (!toolCallId || !pendingToolCallIds.has(toolCallId) || consumedToolCallIds.has(toolCallId)) {
      return false
    }

    consumedToolCallIds.add(toolCallId)
    pendingToolCallIds.delete(toolCallId)
    return true
  })

  if (filteredParts.length === 0) {
    return {
      message: null,
      pendingToolCallIds,
    }
  }

  return {
    message: {
      ...message,
      content: filteredParts.map((part) => {
        if (!isMessagePart(part) || part.type !== 'tool-result') return part
        const output = part.output
        if (!isMessagePart(output) || output.type !== 'text' || typeof output.value !== 'string') return part
        return {
          ...part,
          output: {
            ...output,
            value: projectToolOutputForModel(output.value).text,
          },
        }
      }),
    } as ModelMessage,
    pendingToolCallIds,
  }
}

/**
 * Removes interrupted tool calls from a provider replay while retaining every
 * assistant text part and every tool call that has an adjacent result.
 */
export function sanitizeModelMessages(messages: readonly ModelMessage[]) {
  const sanitizedMessages: ModelMessage[] = []
  let pendingToolCallIds: Set<string> | null = null

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (!message) {
      continue
    }

    if (message.role === 'assistant') {
      const sanitizedAssistant = sanitizeAssistantMessage(message, index, messages)
      pendingToolCallIds = sanitizedAssistant.pendingToolCallIds
      if (sanitizedAssistant.message) {
        sanitizedMessages.push(sanitizedAssistant.message)
      }
      continue
    }

    if (message.role === 'tool') {
      const sanitizedTool = sanitizeToolMessage(message, pendingToolCallIds)
      pendingToolCallIds = sanitizedTool.pendingToolCallIds
      if (sanitizedTool.message) {
        sanitizedMessages.push(sanitizedTool.message)
      }
      continue
    }

    pendingToolCallIds = null
    sanitizedMessages.push(message)
  }

  return sanitizedMessages
}
