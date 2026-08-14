import type { ModelMessage } from 'ai'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function removeAssistantToolCalls(message: ModelMessage): ModelMessage | null {
  if (!Array.isArray(message.content)) return message

  const content = message.content.filter((part) => !(
    isRecord(part) && (part as Record<string, unknown>).type === 'tool-call'
  ))
  return content.length > 0
    ? { ...message, content } as ModelMessage
    : null
}

/**
 * Compacted provider context carries user intent and assistant conclusions.
 * Raw tool calls/results are converted into handoff facts and are not replayed
 * as executable history after the compaction barrier.
 */
export function removeRawToolHistory(messages: readonly ModelMessage[]) {
  return messages.flatMap((message): ModelMessage[] => {
    if (message.role === 'tool') return []
    if (message.role !== 'assistant') return [message]
    const projected = removeAssistantToolCalls(message)
    return projected ? [projected] : []
  })
}
