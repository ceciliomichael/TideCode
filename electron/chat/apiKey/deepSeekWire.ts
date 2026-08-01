function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Applies DeepSeek's reasoning replay contract at the final JSON boundary.
 * Provider-returned reasoning remains intact in canonical history and the UI;
 * only the model-visible wire payload is minimized.
 */
export function normalizeDeepSeekRequestBody(requestBody: Record<string, unknown>) {
  if (!Array.isArray(requestBody.messages)) return requestBody

  const messages = requestBody.messages.map((value) => {
    if (!isRecord(value)) return value

    if (value.role !== 'assistant') return value
    const message = { ...value }
    const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0

    if (hasToolCalls) {
      // DeepSeek thinking-mode tool turns require the key to be present. An
      // empty value keeps interrupted/legacy histories wire-valid.
      if (typeof message.reasoning_content !== 'string') message.reasoning_content = ''
    } else {
      // Plain assistant CoT is response/display data. DeepSeek does not need it
      // in later input, and older reasoner endpoints reject it outright.
      delete message.reasoning_content
      delete message.reasoning
    }

    return message
  })

  return { ...requestBody, messages }
}
