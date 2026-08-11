import type { ToolResultOutput, ToolSet } from '@ai-sdk/provider-utils'
import { formatStructuredToolResultContent, getToolResultModelContent } from '../../../src/lib/toolResultContent'
import {
  formatWebSearchAction,
  formatWebSearchResultAsMarkdown,
  parseWebSearchToolResult,
  parseWebSearchToolResultBody,
} from '../../../src/lib/webSearchResults'
import type { AgentToolExecutionResult } from './toolTypes'

export function isAgentToolExecutionResult(value: unknown): value is AgentToolExecutionResult {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<AgentToolExecutionResult>
  return (
    (candidate.status === 'success' || candidate.status === 'error') &&
    typeof candidate.summary === 'string' &&
    (candidate.body === undefined || typeof candidate.body === 'string') &&
    (candidate.displayBody === undefined || typeof candidate.displayBody === 'string')
  )
}

function stringifyUnknown(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function parseWebSearchOutput(output: unknown) {
  if (typeof output === 'string') {
    return parseWebSearchToolResultBody(output)
  }

  const directResult = parseWebSearchToolResult(output)
  if (directResult) {
    return directResult
  }

  if (isAgentToolExecutionResult(output) && output.body) {
    return parseWebSearchToolResultBody(output.body)
  }

  return null
}

function normalizeWebSearchExecutionResult(output: unknown): AgentToolExecutionResult | null {
  const parsedResult = parseWebSearchOutput(output)
  if (!parsedResult) {
    return null
  }

  const existingResult = isAgentToolExecutionResult(output) ? output : null
  const markdownBody = formatWebSearchResultAsMarkdown(parsedResult)

  return {
    ...(existingResult ?? {}),
    body: markdownBody,
    displayBody: markdownBody,
    status: existingResult?.status ?? 'success',
    summary: existingResult?.summary ?? formatWebSearchAction(parsedResult.action),
  }
}

export function normalizeToolExecutionResult(toolName: string, output: unknown): AgentToolExecutionResult {
  if (toolName === 'web_search') {
    const normalizedWebSearchResult = normalizeWebSearchExecutionResult(output)
    if (normalizedWebSearchResult) {
      return normalizedWebSearchResult
    }
  }

  if (isAgentToolExecutionResult(output)) return output
  return {
    body: typeof output === 'string' ? output : stringifyUnknown(output),
    status: 'success',
    summary: `Completed ${toolName}`,
  }
}

export function createCanonicalToolResultContent(input: {
  argumentsValue: unknown
  body?: string
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
      schema: 'tidecode.tool_result/v1',
      ...(input.result.semantics ? { semantics: input.result.semantics } : {}),
      status: input.result.status,
      ...(input.result.subject ? { subject: input.result.subject } : {}),
      summary: input.result.summary,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      ...(input.result.truncated === undefined ? {} : { truncated: input.result.truncated }),
    },
    input.body ?? input.result.body,
  )
}

export function createCanonicalToolModelOutput(input: {
  argumentsValue: unknown
  output: unknown
  toolCallId: string
  toolName: string
}): ToolResultOutput {
  const result = normalizeToolExecutionResult(input.toolName, input.output)
  if (result.modelOutput) {
    return result.modelOutput
  }
  const structuredContent = createCanonicalToolResultContent({
    argumentsValue: input.argumentsValue,
    result,
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
