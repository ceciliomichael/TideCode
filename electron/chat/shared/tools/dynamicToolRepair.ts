import { NoSuchToolError, type ToolCallRepairFunction, type ToolSet } from 'ai'
import { DYNAMIC_EXECUTE_TOOL_NAME, isRecord } from './dynamicToolContracts'

function parseDirectToolInput(input: string): Record<string, unknown> | null {
  const trimmedInput = input.trim()
  if (trimmedInput.length === 0) {
    return {}
  }

  try {
    const parsedInput: unknown = JSON.parse(trimmedInput)
    return isRecord(parsedInput) ? parsedInput : null
  } catch {
    return null
  }
}

/**
 * Recovery path for models that emit a private native tool name despite
 * receiving only the three dynamic tool definitions. Route the failed call
 * into discovery instead of silently executing an assumed tool.
 */
export const repairDirectDynamicToolCall: ToolCallRepairFunction<ToolSet> = async ({
  error,
  toolCall,
}) => {
  if (!NoSuchToolError.isInstance(error) || toolCall.toolName === DYNAMIC_EXECUTE_TOOL_NAME) {
    return null
  }

  const directInput = parseDirectToolInput(toolCall.input)
  if (!directInput || toolCall.toolName.trim().length === 0) {
    return null
  }

  return {
    ...toolCall,
    input: JSON.stringify({
      query: toolCall.toolName,
    }),
    toolName: 'list_tools',
  }
}
