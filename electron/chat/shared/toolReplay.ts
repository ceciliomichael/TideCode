import type { ToolResultOutput, ToolSet } from '@ai-sdk/provider-utils'
import { formatStructuredToolResultContent, getToolResultModelContent } from '../../../src/lib/toolResultContent'
import type { AgentToolExecutionResult } from './toolTypes'

export function isAgentToolExecutionResult(value: unknown): value is AgentToolExecutionResult {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<AgentToolExecutionResult>
  return (
    (candidate.status === 'success' || candidate.status === 'error') &&
    typeof candidate.summary === 'string' &&
    (candidate.body === undefined || typeof candidate.body === 'string')
  )
}

function stringifyUnknown(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function normalizeToolExecutionResult(toolName: string, output: unknown): AgentToolExecutionResult {
  if (isAgentToolExecutionResult(output)) return output
  return {
    body: typeof output === 'string' ? output : stringifyUnknown(output),
    status: 'success',
    summary: `Completed ${toolName}`,
  }
}

export function createCanonicalToolResultContent(input: {
  argumentsValue: unknown
  result: AgentToolExecutionResult
  toolCallId: string
  toolName: string
}) {
  return formatStructuredToolResultContent(
    {
      arguments:
        typeof input.argumentsValue === 'object' && input.argumentsValue !== null
          ? (input.argumentsValue as Record<string, unknown>)
          : undefined,
      schema: 'echosphere.tool_result/v1',
      ...(input.result.semantics ? { semantics: input.result.semantics } : {}),
      status: input.result.status,
      ...(input.result.subject ? { subject: input.result.subject } : {}),
      summary: input.result.summary,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      ...(input.result.truncated === undefined ? {} : { truncated: input.result.truncated }),
    },
    input.result.body,
  )
}

export function createCanonicalToolModelOutput(input: {
  argumentsValue: unknown
  output: unknown
  toolCallId: string
  toolName: string
}): ToolResultOutput {
  const structuredContent = createCanonicalToolResultContent({
    argumentsValue: input.argumentsValue,
    result: normalizeToolExecutionResult(input.toolName, input.output),
    toolCallId: input.toolCallId,
    toolName: input.toolName,
  })
  return { type: 'text', value: getToolResultModelContent(structuredContent) }
}

export function withCanonicalToolModelOutputs(tools: ToolSet): ToolSet {
  return Object.fromEntries(Object.keys(tools).sort().map((toolName) => {
    const tool = tools[toolName]
    if (typeof tool.execute !== 'function') return [toolName, tool]
    return [
      toolName,
      {
        ...tool,
        toModelOutput: tool.toModelOutput ?? ((input: { input: unknown; output: unknown; toolCallId: string }) =>
          createCanonicalToolModelOutput({
            argumentsValue: input.input,
            output: input.output,
            toolCallId: input.toolCallId,
            toolName,
          })),
      },
    ]
  })) as ToolSet
}
