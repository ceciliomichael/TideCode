export interface CodeModeToolCallOutput {
  body?: string
  name: string
  status: 'error' | 'success'
  summary: string
}

const IMPLICIT_TOOL_RESULT_OUTPUT_LIMIT = 32_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isReturnedToolResult(value: unknown): value is Record<string, unknown> & {
  body?: string
  status: 'error' | 'success'
  summary: string
} {
  return isRecord(value) &&
    (value.status === 'error' || value.status === 'success') &&
    typeof value.summary === 'string' &&
    (value.body === undefined || typeof value.body === 'string')
}

function limitOutput(value: string) {
  if (value.length <= IMPLICIT_TOOL_RESULT_OUTPUT_LIMIT) {
    return value
  }

  return `${value.slice(0, IMPLICIT_TOOL_RESULT_OUTPUT_LIMIT)}\n\n[Additional tool output omitted.]`
}

/**
 * Keeps structured program returns valid JSON, while avoiding a second JSON
 * encoding when the program directly returns one inner ToolResult. The inner
 * call is already retained in Code Mode receipts, so its literal body is the
 * useful model-facing evidence here.
 */
export function formatExplicitCodeModeOutput(value: unknown) {
  if (value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (isReturnedToolResult(value)) {
    return value.body ?? value.summary
  }

  try {
    return JSON.stringify(value, null, 2) ?? ''
  } catch {
    return String(value)
  }
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
