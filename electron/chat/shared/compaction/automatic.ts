import type { ModelMessage } from 'ai'
import { stableStringify } from '../../cache/canonicalization'

export type AutomaticCompactionTrigger = 'user_turn' | 'tool_result' | 'model_step'

interface AutomaticCompactionTriggerInput {
  abortSignal?: AbortSignal
  messages: readonly ModelMessage[]
  responseMessages: readonly ModelMessage[]
  stepNumber: number
}

function containsToolResult(messages: readonly ModelMessage[]) {
  return messages.some((message) => message.role === 'tool')
}

function messageKey(message: ModelMessage) {
  return stableStringify(message)
}

/**
 * Merges response messages for callers that are building a transcript from
 * separate message collections.
 *
 * AI SDK's `messages` value is already the authoritative carry-forward state
 * for the live prepareStep path. After returning a compacted projection, the
 * SDK's responseMessages remains cumulative for the whole run; appending it
 * again would resurrect messages that compaction deliberately removed.
 */
export function mergeAutomaticCompactionMessages(input: {
  messages: readonly ModelMessage[]
  responseMessages: readonly ModelMessage[]
  responseMessagesAreCumulative?: boolean
}) {
  if (input.responseMessagesAreCumulative) {
    return [...input.messages]
  }

  const remainingMessageCounts = new Map<string, number>()
  for (const message of input.messages) {
    const key = messageKey(message)
    remainingMessageCounts.set(key, (remainingMessageCounts.get(key) ?? 0) + 1)
  }

  const mergedMessages = [...input.messages]
  for (const responseMessage of input.responseMessages) {
    const key = messageKey(responseMessage)
    const remainingCount = remainingMessageCounts.get(key) ?? 0
    if (remainingCount > 0) {
      remainingMessageCounts.set(key, remainingCount - 1)
      continue
    }

    mergedMessages.push(responseMessage)
  }

  // Keep the exact provider-facing message content here. The context
  // indicator and the automatic threshold must judge the same bytes/tokens.
  // Tool output is bounded separately when it is serialized into the
  // compaction summary prompt, so retaining it here does not expose the
  // compaction model to an unbounded transcript.
  return mergedMessages
}

/**
 * `prepareStep` is called immediately before each model request. Every live
 * continuation is a valid point to evaluate the budget; the compaction
 * service remains responsible for deciding whether the threshold was crossed
 * and whether a safe history boundary exists.
 *
 * Tool-result detection is retained as a descriptive trigger for diagnostics,
 * but it must not be a gate: providers can append assistant or reasoning
 * messages after a tool result while still remaining at the same continuation
 * boundary.
 */
export function resolveAutomaticCompactionTrigger(
  input: AutomaticCompactionTriggerInput,
): AutomaticCompactionTrigger | null {
  if (input.abortSignal?.aborted) {
    return null
  }

  if (input.stepNumber === 0) {
    return 'user_turn'
  }

  if (input.stepNumber > 0 && containsToolResult(input.responseMessages)) {
    return 'tool_result'
  }

  if (input.stepNumber > 0 && containsToolResult(input.messages)) {
    return 'tool_result'
  }

  return input.stepNumber > 0 ? 'model_step' : null
}
