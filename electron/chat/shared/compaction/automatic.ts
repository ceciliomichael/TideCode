import type { ModelMessage } from 'ai'

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
