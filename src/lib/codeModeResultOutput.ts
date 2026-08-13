export interface CodeModeToolCallOutput {
  body?: string
  name: string
  status: 'error' | 'success'
  summary: string
}

const IMPLICIT_TOOL_RESULT_OUTPUT_LIMIT = 32_000

function limitOutput(value: string) {
  if (value.length <= IMPLICIT_TOOL_RESULT_OUTPUT_LIMIT) {
    return value
  }

  return `${value.slice(0, IMPLICIT_TOOL_RESULT_OUTPUT_LIMIT)}\n\n[Additional tool output omitted.]`
}

/**
 * Gives the model useful evidence when a Code Mode program performs tool calls
 * but does not explicitly return a value. A bare `tools.*(...)` statement
 * still executes, but the async program itself resolves to `undefined`.
 */
export function formatImplicitCodeModeToolResults(toolCalls: readonly CodeModeToolCallOutput[]) {
  if (toolCalls.length === 0) {
    return ''
  }

  const sections = toolCalls.map((toolCall) => {
    const body = toolCall.body?.trim() || toolCall.summary.trim()
    return `${toolCall.name} (${toolCall.status}):\n${body}`
  })

  return limitOutput([
    'The program completed tool calls but returned no explicit value.',
    ...sections,
  ].join('\n\n'))
}
