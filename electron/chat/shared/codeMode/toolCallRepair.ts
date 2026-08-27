import type { LanguageModelV4ToolCall } from '@ai-sdk/provider'
import type { ToolCallRepairFunction, ToolSet } from 'ai'

import type { AgentToolRegistry } from '../tools/registry'

const INNER_TOOL_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u

function parseInnerToolInput(
  rawInput: string,
  entry: NonNullable<ReturnType<AgentToolRegistry['get']>>,
): unknown | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawInput) as unknown
  } catch {
    return entry.inputSchema.type === 'string' && rawInput.trim().length > 0 ? rawInput : null
  }

  if (entry.inputSchema.type === 'string') {
    return typeof parsed === 'string' ? parsed : null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  return parsed
}

function encodeCodeModeSource(providerTools: ToolSet, source: string) {
  const codeModeTool = providerTools.code_mode as { id?: unknown; type?: unknown } | undefined
  return codeModeTool?.type === 'provider' && codeModeTool.id === 'openai.custom'
    ? source
    : JSON.stringify({ source })
}

export function repairMisroutedCodeModeToolCall(input: {
  providerTools: ToolSet
  registry: AgentToolRegistry
  toolCall: LanguageModelV4ToolCall
}): LanguageModelV4ToolCall | null {
  const providerToolNames = Object.keys(input.providerTools)
  if (providerToolNames.length !== 1 || providerToolNames[0] !== 'code_mode') {
    return null
  }

  if (input.toolCall.toolName.trim() === 'code_mode') {
    return null
  }

  const match = /^tools\.([A-Za-z_$][A-Za-z0-9_$]*)$/u.exec(input.toolCall.toolName.trim())
  const innerToolName = match?.[1]
  const entry = innerToolName && INNER_TOOL_NAME_PATTERN.test(innerToolName)
    ? input.registry.get(innerToolName)
    : undefined
  if (!innerToolName || !entry) {
    return null
  }

  const innerInput = parseInnerToolInput(input.toolCall.input, entry)
  if (innerInput === null) {
    return null
  }

  const source = [
    'const result = await tools.' + innerToolName + '(' + JSON.stringify(innerInput) + ');',
    'return result;',
  ].join('\n')

  return {
    input: encodeCodeModeSource(input.providerTools, source),
    toolCallId: input.toolCall.toolCallId,
    toolName: 'code_mode',
    type: 'tool-call',
  }
}

export function createCodeModeToolCallRepair(
  registry: AgentToolRegistry,
): ToolCallRepairFunction<ToolSet> {
  return async ({ toolCall, tools }) => repairMisroutedCodeModeToolCall({
    providerTools: tools,
    registry,
    toolCall,
  })
}
