import { jsonSchema, tool } from 'ai'
import type { AgentToolExecutionResult, AgentToolContext } from '../toolTypes'
import { createSuccessResult } from './workspaceToolResults'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'
import {
  normalizeMcpToolSearchInput,
  type McpToolSearchInput,
} from '../../../mcp/mcpToolSearch'
import type { McpToolExecutionOutput } from '../../../mcp/mcpToolExecution'

const MCP_TOOL_SEARCH_DESCRIPTION =
  'Search connected MCP tools by query. Use include_schema true to retrieve the exact input schema for a selected tool.'
const EXECUTE_MCP_DESCRIPTION =
  'Execute one MCP tool returned by mcp_tool_search using its exact tool_id, its exact name as tool_name, and an object of arguments.'

const MCP_TOOL_SEARCH_INPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    include_schema: {
      default: false,
      description: 'Return each matching tool input schema when true.',
      type: 'boolean',
    },
    limit: {
      default: 5,
      description: 'Maximum number of matching tools to return. Must be between 1 and 20.',
      maximum: 20,
      minimum: 1,
      type: 'integer',
    },
    query: {
      description: 'Tool name, server name, capability, or natural-language task.',
      minLength: 1,
      type: 'string',
    },
  },
  required: ['query'],
  type: 'object',
} as const

const EXECUTE_MCP_INPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    arguments: {
      additionalProperties: true,
      description: 'Arguments matching the input schema returned by mcp_tool_search.',
      type: 'object',
    },
    tool_id: {
      description: 'The exact tool_id returned by mcp_tool_search.',
      minLength: 1,
      type: 'string',
    },
    tool_name: {
      description: 'The exact name returned by mcp_tool_search. Copy it unchanged for clear execution status text.',
      minLength: 1,
      type: 'string',
    },
  },
  required: ['tool_id', 'arguments'],
  type: 'object',
} as const

interface McpExecuteInput {
  arguments: Record<string, unknown>
  tool_id: string
  tool_name?: string
}

function isElectronRuntime() {
  return typeof process !== 'undefined' && Boolean(process.versions?.electron)
}

async function getMcpServerManager() {
  if (!isElectronRuntime()) {
    throw new Error('MCP tools are available only in the Electron runtime.')
  }

  const module = await import('../../../mcp/serverManager')
  return module.getMcpServerManager()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeMcpExecuteInput(input: unknown): McpExecuteInput {
  if (!isRecord(input)) {
    throw new Error('execute_mcp requires an object argument.')
  }

  const toolId = typeof input.tool_id === 'string' ? input.tool_id.trim() : ''
  if (toolId.length === 0) {
    throw new Error('execute_mcp requires a non-empty "tool_id".')
  }

  if (!isRecord(input.arguments)) {
    throw new Error('execute_mcp requires an object "arguments" value.')
  }

  const toolName = input.tool_name === undefined ? undefined : typeof input.tool_name === 'string' ? input.tool_name.trim() : ''
  if (toolName !== undefined && toolName.length === 0) {
    throw new Error('execute_mcp "tool_name" must be a non-empty string when provided.')
  }

  return {
    arguments: input.arguments,
    tool_id: toolId,
    ...(toolName === undefined ? {} : { tool_name: toolName }),
  }
}

function createMcpExecutionResult(
  output: McpToolExecutionOutput,
): AgentToolExecutionResult {
  const commonResult = {
    ...(output.body.length > 0 ? { body: output.body } : {}),
    semantics: {
      mcp_server_name: output.serverName,
      mcp_tool_id: output.toolId,
      mcp_tool_name: output.toolName,
      operation: 'mcp_execute',
    },
    subject: {
      kind: 'mcp_tool',
      path: output.toolName,
    },
  }

  if (output.isError) {
    return {
      ...commonResult,
      status: 'error',
      summary: `MCP tool ${output.toolName} failed.`,
    }
  }

  return {
    ...commonResult,
    status: 'success',
    summary: `Ran ${output.toolName}`,
  }
}

export function createMcpToolSet(context: AgentToolContext) {
  return {
    execute_mcp: tool({
      description: EXECUTE_MCP_DESCRIPTION,
      inputSchema: jsonSchema<McpExecuteInput>(EXECUTE_MCP_INPUT_SCHEMA),
      execute: async (rawInput): Promise<AgentToolExecutionResult> => {
        try {
          const input = normalizeMcpExecuteInput(rawInput)
          const manager = await getMcpServerManager()
          const output = await manager.executeTool(input.tool_id, input.arguments, context.workspaceRootPath)
          return createMcpExecutionResult(output)
        } catch (error) {
          return createToolErrorResult(getToolErrorSummary(error, 'MCP tool execution failed.'))
        }
      },
    }),
    mcp_tool_search: tool({
      description: MCP_TOOL_SEARCH_DESCRIPTION,
      inputSchema: jsonSchema<McpToolSearchInput>(MCP_TOOL_SEARCH_INPUT_SCHEMA),
      execute: async (rawInput): Promise<AgentToolExecutionResult> => {
        try {
          const input = normalizeMcpToolSearchInput(rawInput)
          const manager = await getMcpServerManager()
          const result = await manager.searchTools(input, context.workspaceRootPath)
          const body = JSON.stringify(result, null, 2)

          return createSuccessResult({
            body,
            semantics: {
              include_schema: result.include_schema,
              match_count: result.tools.length,
              operation: 'mcp_search',
              query: result.query,
            },
            subject: {
              kind: 'mcp_search',
              path: result.query,
            },
            summary: `Searched for MCP ${result.query}`,
          })
        } catch (error) {
          return createToolErrorResult(getToolErrorSummary(error, 'MCP tool search failed.'))
        }
      },
    }),
  }
}
