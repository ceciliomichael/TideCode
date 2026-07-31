import { limitModelToolResultForContext } from '../../../src/lib/toolResultContent'

// Reasonix's current DeepSeek loop keeps stale tool results near a 3,000-token
// budget. Keep this policy at the DeepSeek wire boundary so the UI and durable
// conversation history retain the complete result and every other provider's
// request remains unchanged.
export const DEEPSEEK_TOOL_RESULT_REPLAY_MAX_BYTES = 12 * 1024
export const DEEPSEEK_TOOL_RESULT_TRUNCATION_MARKER =
  '\n\n[Earlier tool result shortened for DeepSeek context efficiency. Re-read with a narrower query or range if the omitted section is needed.]\n\n'

export function limitDeepSeekToolResultContent(content: string) {
  return limitModelToolResultForContext(
    content,
    DEEPSEEK_TOOL_RESULT_REPLAY_MAX_BYTES,
    DEEPSEEK_TOOL_RESULT_TRUNCATION_MARKER,
  )
}
