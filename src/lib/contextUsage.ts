import type { Message } from '../types/chat'

export function approximateTokenCount(value: string) {
  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? Math.ceil(trimmedValue.length / 4) : 0
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
        historyTokens += 1_024
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
