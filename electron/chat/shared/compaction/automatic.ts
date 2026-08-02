import type { ModelMessage } from 'ai'

export type AutomaticCompactionTrigger = 'user_turn' | 'tool_result'

interface AutomaticCompactionTriggerInput {
  abortSignal?: AbortSignal
  messages: readonly ModelMessage[]
  responseMessages: readonly ModelMessage[]
  stepNumber: number
}

function endsWithToolResult(messages: readonly ModelMessage[]) {
  return messages.at(-1)?.role === 'tool'
}

/**
 * Automatic compaction is only allowed at boundaries where the model is about
 * to receive a user turn or continue after a completed tool step. Keeping the
 * decision separate from the compaction service prevents a provider callback
 * or an abort cleanup from accidentally turning into a compaction trigger.
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

  if (input.stepNumber > 0 && endsWithToolResult(input.responseMessages)) {
    return 'tool_result'
  }

  if (input.stepNumber > 0 && endsWithToolResult(input.messages)) {
    return 'tool_result'
  }

  return null
}
