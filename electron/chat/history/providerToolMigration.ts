import type { ModelMessage } from 'ai'

type MessagePart = Record<string, unknown>

interface PendingToolCall {
  input: unknown
  toolName: string
}

function isRecord(value: unknown): value is MessagePart {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getContentParts(message: ModelMessage): MessagePart[] | null {
  const content = (message as { content?: unknown }).content
  return Array.isArray(content) && content.every(isRecord) ? content : null
}

function stringifyValue(value: unknown) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function getToolResultText(part: MessagePart) {
  const output = part.output
  if (!isRecord(output)) return stringifyValue(output)
  if (typeof output.value === 'string') return output.value
  if ('value' in output) return stringifyValue(output.value)
  return stringifyValue(output)
}

function formatToolExchange(toolCall: PendingToolCall, resultText: string) {
  return [
    'Previous tool exchange from another provider:',
    `Tool: ${toolCall.toolName}`,
    'Arguments:',
    stringifyValue(toolCall.input ?? {}),
    'Result:',
    resultText,
  ].join('\n')
}

function appendUserText(messages: ModelMessage[], text: string) {
  const lastMessage = messages.at(-1)
  if (lastMessage?.role === 'user' && typeof lastMessage.content === 'string') {
    messages[messages.length - 1] = {
      ...lastMessage,
      content: `${lastMessage.content}\n\n${text}`,
    }
    return
  }

  messages.push({ content: text, role: 'user' })
}

function migrateAssistantMessage(
  message: ModelMessage,
  pendingToolCalls: Map<string, PendingToolCall>,
  migratedMessages: ModelMessage[],
) {
  const parts = getContentParts(message)
  if (!parts) {
    migratedMessages.push(message)
    return
  }

  const retainedParts: MessagePart[] = []
  for (const part of parts) {
    if (part.type !== 'tool-call' || typeof part.toolCallId !== 'string' || typeof part.toolName !== 'string') {
      retainedParts.push(part)
      continue
    }

    pendingToolCalls.set(part.toolCallId, {
      input: part.input ?? part.args,
      toolName: part.toolName,
    })
  }

  if (retainedParts.length > 0) {
    migratedMessages.push({ ...message, content: retainedParts } as ModelMessage)
  }
}

function migrateToolMessage(
  message: ModelMessage,
  pendingToolCalls: Map<string, PendingToolCall>,
  migratedMessages: ModelMessage[],
) {
  const parts = getContentParts(message)
  if (!parts) {
    appendUserText(migratedMessages, `Previous tool result:\n${stringifyValue(message.content)}`)
    return
  }

  for (const part of parts) {
    if (part.type !== 'tool-result' || typeof part.toolCallId !== 'string') {
      appendUserText(migratedMessages, `Previous tool result:\n${stringifyValue(part)}`)
      continue
    }

    const toolCall = pendingToolCalls.get(part.toolCallId) ?? {
      input: {},
      toolName: typeof part.toolName === 'string' ? part.toolName : 'unknown',
    }
    pendingToolCalls.delete(part.toolCallId)
    appendUserText(migratedMessages, formatToolExchange(toolCall, getToolResultText(part)))
  }
}

export function migrateToolHistoryToUserInput(messages: readonly ModelMessage[]) {
  const migratedMessages: ModelMessage[] = []
  const pendingToolCalls = new Map<string, PendingToolCall>()

  for (const message of messages) {
    if (message.role === 'assistant') {
      migrateAssistantMessage(message, pendingToolCalls, migratedMessages)
      continue
    }

    if (message.role === 'tool') {
      migrateToolMessage(message, pendingToolCalls, migratedMessages)
      continue
    }

    pendingToolCalls.clear()
    migratedMessages.push(message)
  }

  return migratedMessages
}
