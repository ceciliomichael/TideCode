import type { LanguageModelV4ToolCall } from '@ai-sdk/provider'
import type { ToolCallRepairFunction, ToolSet } from 'ai'

import type { AgentToolRegistry } from '../tools/registry'

const INNER_TOOL_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u

function parseToolInput(input: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(input) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
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

  const match = /^tools\.([A-Za-z_$][A-Za-z0-9_$]*)$/u.exec(input.toolCall.toolName.trim())
  const innerToolName = match?.[1]
  if (!innerToolName || !INNER_TOOL_NAME_PATTERN.test(innerToolName) || !input.registry.get(innerToolName)) {
    return null
  }

  const innerInput = parseToolInput(input.toolCall.input)
  if (!innerInput) {
    return null
  }

  const code = [
    'const result = await tools.' + innerToolName + '(' + JSON.stringify(innerInput) + ');',
    'return result;',
  ].join('\n')

  return {
    input: JSON.stringify({ code }),
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
