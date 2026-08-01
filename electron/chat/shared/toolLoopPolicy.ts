import type { StopCondition, ToolSet } from 'ai'

/**
 * The interactive agent loop has no artificial step ceiling. The AI SDK still
 * stops naturally when the model produces a final response without tool calls,
 * and the runtime abort signal remains available for user cancellation.
 */
export const continueToolLoopUntilModelStops: StopCondition<ToolSet> = () => false
