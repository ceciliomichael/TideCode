import type { ModelMessage } from 'ai'

export interface ConversationTurnRange {
  endIndex: number
  startIndex: number
}

/**
 * Groups model messages by user-visible turn. A turn starts with a user
 * message and includes every assistant/tool message until the next user
 * message. Consecutive user messages are kept in the same turn so same-turn
 * steering does not consume a retention slot.
 */
export function findConversationTurnRanges(
  messages: readonly ModelMessage[],
  startIndex = 0,
) {
  const normalizedStartIndex = Math.max(0, Math.min(startIndex, messages.length))
  const ranges: ConversationTurnRange[] = []
  let currentStartIndex: number | null = null
  let hasNonUserMessage = false

  for (let index = normalizedStartIndex; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role === 'user') {
      if (currentStartIndex === null) {
        currentStartIndex = index
        hasNonUserMessage = false
      } else if (hasNonUserMessage) {
        ranges.push({
          endIndex: index,
          startIndex: currentStartIndex,
        })
        currentStartIndex = index
        hasNonUserMessage = false
      }
      continue
    }

    if (currentStartIndex !== null) {
      hasNonUserMessage = true
    }
  }

  if (currentStartIndex !== null) {
    ranges.push({
      endIndex: messages.length,
      startIndex: currentStartIndex,
    })
  }

  return ranges
}
